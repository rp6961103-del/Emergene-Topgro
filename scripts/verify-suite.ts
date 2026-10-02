import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3001; // Run test server on isolated port
process.env.PORT = String(PORT);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'emergene_topgro_test_secret_key_2026_xyz';

const BASE_URL = `http://127.0.0.1:${PORT}`;

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details?: string) {
  results.push({ name, passed, details });
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}${details ? ` - ${details}` : ''}`);
}

async function run() {
  console.log('--- Starting Verification Suite ---');

  // Import and boot server
  const { default: express } = await import('express');
  const productsRouter = (await import('../backend/routes/products.ts')).default;
  const categoriesRouter = (await import('../backend/routes/categories.ts')).default;
  const ordersRouter = (await import('../backend/routes/orders.ts')).default;
  const authRouter = (await import('../backend/routes/auth.ts')).default;
  const enquiriesRouter = (await import('../backend/routes/enquiries.ts')).default;
  const settingsRouter = (await import('../backend/routes/settings.ts')).default;
  const { requestLogger } = await import('../backend/middleware/logging.ts');
  const { errorHandler } = await import('../backend/middleware/errorHandler.ts');
  const { db } = await import('../backend/services/db.ts');

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use(requestLogger);

  app.use('/api/products', productsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/enquiries', enquiriesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api', errorHandler);

  const server = app.listen(PORT, '127.0.0.1');
  await new Promise(r => setTimeout(r, 500));

  try {
    // 1. Fresh browser / No session: Accessing protected endpoint without token
    const resNoToken = await fetch(`${BASE_URL}/api/orders`);
    const dataNoToken = await resNoToken.json();
    record(
      'No session returns 401',
      resNoToken.status === 401 && dataNoToken.code === 'AUTH_HEADER_MISSING',
      `Status: ${resNoToken.status}, Code: ${dataNoToken.code}`
    );

    // 2. Valid Admin Login
    const resAdminLogin = await fetch(`${BASE_URL}/api/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'Owner@12345' })
    });
    const adminLoginData = await resAdminLogin.json();
    const adminToken = adminLoginData.token;
    record(
      'Admin login',
      resAdminLogin.status === 200 && adminLoginData.user?.role === 'admin' && typeof adminToken === 'string',
      `Status: ${resAdminLogin.status}, User: ${adminLoginData.user?.email}`
    );

    // 3. /api/auth/me with admin token
    const resAuthMe = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const authMeData = await resAuthMe.json();
    record(
      '/api/auth/me',
      resAuthMe.status === 200 && authMeData.role === 'admin' && authMeData.id === 'user_admin_001',
      `Status: ${resAuthMe.status}, Verified Role: ${authMeData.role}`
    );

    // 4. Admin browser refresh simulation
    const [dashOrders, dashProds, dashCats] = await Promise.all([
      fetch(`${BASE_URL}/api/orders`, { headers: { Authorization: `Bearer ${adminToken}` } }),
      fetch(`${BASE_URL}/api/products`),
      fetch(`${BASE_URL}/api/categories`)
    ]);
    const ordersData = await dashOrders.json();
    record(
      'Admin browser refresh',
      dashOrders.status === 200 && dashProds.status === 200 && dashCats.status === 200 && Array.isArray(ordersData),
      `Orders: ${dashOrders.status}, Products: ${dashProds.status}, Categories: ${dashCats.status}`
    );

    // 5. Invalid JWT
    const resInvalidJwt = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: 'Bearer this.is.an.invalid.jwt.token' }
    });
    const invalidJwtData = await resInvalidJwt.json();
    record(
      'Invalid JWT',
      resInvalidJwt.status === 401 && invalidJwtData.code === 'AUTH_TOKEN_INVALID',
      `Status: ${resInvalidJwt.status}, Code: ${invalidJwtData.code}`
    );

    // 6. Expired JWT
    const expiredToken = jwt.sign(
      { id: 'user_admin_001', email: 'admin@emergene.com', role: 'admin' },
      process.env.JWT_SECRET!,
      { expiresIn: '-10s' }
    );
    const resExpiredJwt = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    const expiredJwtData = await resExpiredJwt.json();
    record(
      'Expired JWT',
      resExpiredJwt.status === 401 && expiredJwtData.code === 'AUTH_TOKEN_EXPIRED',
      `Status: ${resExpiredJwt.status}, Code: ${expiredJwtData.code}`
    );

    // 7. Customer login & Customer admin access
    const resCustLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'farmer@example.com', password: 'farmer123' })
    });
    const custLoginData = await resCustLogin.json();
    const customerToken = custLoginData.token;

    const resCustAdminAccess = await fetch(`${BASE_URL}/api/orders`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const custAdminData = await resCustAdminAccess.json();

    const resCustAdminLogin = await fetch(`${BASE_URL}/api/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'farmer@example.com', password: 'farmer123' })
    });

    record(
      'Customer admin access',
      resCustAdminAccess.status === 403 && custAdminData.code === 'FORBIDDEN_ADMIN_REQUIRED' && resCustAdminLogin.status === 403,
      `Order access: ${resCustAdminAccess.status}, Admin login: ${resCustAdminLogin.status}`
    );

    // 8. Wrong password test
    const resWrongPass = await fetch(`${BASE_URL}/api/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'wrongpassword' })
    });
    record(
      'Wrong password rejects with 401',
      resWrongPass.status === 401,
      `Status: ${resWrongPass.status}`
    );

    // 9. Product CRUD as admin
    const testProdSku = `TEST-SKU-${Date.now()}`;
    const createProdRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Automated Test Product',
        slug: `auto-test-product-${Date.now()}`,
        sku: testProdSku,
        category: 'Bio-Stimulants',
        brand: 'EMERGENE',
        stock: 45,
        packSizes: [{ size: '1 L', price: 950, priceAvailable: true }]
      })
    });
    const createdProd = await createProdRes.json();

    const updateProdRes = await fetch(`${BASE_URL}/api/products/${createdProd._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ stock: 55 })
    });
    const updatedProd = await updateProdRes.json();

    const deleteProdRes = await fetch(`${BASE_URL}/api/products/${createdProd._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    record(
      'Product CRUD',
      createProdRes.status === 201 && updateProdRes.status === 200 && updatedProd.stock === 55 && deleteProdRes.status === 200,
      `Create: ${createProdRes.status}, Update: ${updateProdRes.status}, Delete: ${deleteProdRes.status}`
    );

    // 10. Category CRUD as admin
    const createCatRes = await fetch(`${BASE_URL}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: `Test Category ${Date.now()}`,
        slug: `test-cat-${Date.now()}`,
        description: 'Automated category testing'
      })
    });
    const createdCat = await createCatRes.json();

    const updateCatRes = await fetch(`${BASE_URL}/api/categories/${createdCat.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ description: 'Updated category description' })
    });

    const deleteCatRes = await fetch(`${BASE_URL}/api/categories/${createdCat.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    record(
      'Category CRUD',
      createCatRes.status === 201 && updateCatRes.status === 200 && deleteCatRes.status === 200,
      `Create: ${createCatRes.status}, Update: ${updateCatRes.status}, Delete: ${deleteCatRes.status}`
    );

    // 11. Orders management
    const allOrders = db.orders.getAll();
    let orderUpdateOk = false;
    if (allOrders.length > 0) {
      const targetOrderId = allOrders[0]._id;
      const updateOrderRes = await fetch(`${BASE_URL}/api/orders/${targetOrderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'Processing', notes: 'Automated test note' })
      });
      orderUpdateOk = updateOrderRes.status === 200;
    }
    record(
      'Orders',
      ordersData.length > 0 && orderUpdateOk,
      `Listed ${ordersData.length} orders, status update passed: ${orderUpdateOk}`
    );

    // 12. Enquiries management
    const submitEnqRes = await fetch(`${BASE_URL}/api/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Farmer',
        phone: '+91 99999 88888',
        email: 'testfarmer@example.com',
        subject: 'Soil testing enquiry',
        message: 'Looking for organic soil conditioning guidance.'
      })
    });
    const submittedEnq = await submitEnqRes.json();

    const listEnqRes = await fetch(`${BASE_URL}/api/enquiries`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const enqsData = await listEnqRes.json();

    const updateEnqRes = await fetch(`${BASE_URL}/api/enquiries/${submittedEnq._id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'responded' })
    });

    record(
      'Enquiries',
      submitEnqRes.status === 201 && listEnqRes.status === 200 && updateEnqRes.status === 200,
      `Submit: ${submitEnqRes.status}, List: ${listEnqRes.status}, Update: ${updateEnqRes.status}`
    );

    // 13. Settings
    const getSettingsRes = await fetch(`${BASE_URL}/api/settings`);
    const custUpdateSettingsRes = await fetch(`${BASE_URL}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ tagline: 'Should Fail for Customer' })
    });
    const adminUpdateSettingsRes = await fetch(`${BASE_URL}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tagline: 'Quality Agricultural Products for Better Farming' })
    });

    record(
      'Settings',
      getSettingsRes.status === 200 && custUpdateSettingsRes.status === 403 && adminUpdateSettingsRes.status === 200,
      `Public GET: ${getSettingsRes.status}, Customer PUT: ${custUpdateSettingsRes.status}, Admin PUT: ${adminUpdateSettingsRes.status}`
    );

    // 14. Image Upload Security
    // Tiny valid 1x1 transparent PNG base64
    const validPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAEASTvAAAAAElFTkSuQmCC';
    
    // Test customer rejected
    const custUploadRes = await fetch(`${BASE_URL}/api/products/prod_001/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ imageBase64: validPngBase64 })
    });

    // Test invalid mime rejected
    const invalidMimeRes = await fetch(`${BASE_URL}/api/products/prod_001/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ imageBase64: 'data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA//8AALgAAAA=' })
    });

    // Test valid admin upload
    const adminUploadRes = await fetch(`${BASE_URL}/api/products/prod_001/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ imageBase64: validPngBase64, filename: 'test-audit-img' })
    });
    const adminUploadData = await adminUploadRes.json();

    const projectRoot = path.resolve(__dirname, '..');
    const savedFilePath = adminUploadData.imageUrl
      ? path.join(projectRoot, 'public', adminUploadData.imageUrl.replace(/^\/images\//, 'images/'))
      : '';
    const fileSaved = Boolean(savedFilePath && fs.existsSync(savedFilePath));

    record(
      'Image upload',
      custUploadRes.status === 403 && invalidMimeRes.status === 400 && adminUploadRes.status === 200 && fileSaved,
      `Customer blocked: ${custUploadRes.status}, Invalid rejected: ${invalidMimeRes.status}, Admin saved: ${adminUploadRes.status}, File exists: ${fileSaved}`
    );

    // Clean up uploaded test image and restore product state
    if (fileSaved && fs.existsSync(savedFilePath)) {
      try { fs.unlinkSync(savedFilePath); } catch {}
    }
    db.products.update('prod_001', {
      images: ['/images/products/shield.jpg', '/images/products/shield.svg']
    });

    // 15. Database persistence
    // Check that files in backend/data/ are non-empty valid JSON
    const dataDir = path.join(projectRoot, 'backend', 'data');
    const productsFile = path.join(dataDir, 'products.json');
    const usersFile = path.join(dataDir, 'users.json');
    const ordersFile = path.join(dataDir, 'orders.json');
    const hasPersistence = fs.existsSync(productsFile) && fs.existsSync(usersFile) && fs.existsSync(ordersFile);
    const parsedUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const adminUsers = parsedUsers.filter((user: { role: string }) => user.role === 'admin');
    const adminCredentialIsHashed = adminUsers.length === 1
      && adminUsers[0].username === 'owner'
      && /^\$2[aby]\$\d{2}\$/.test(adminUsers[0].passwordHash);

    record(
      'Database persistence',
      hasPersistence && Array.isArray(parsedUsers) && parsedUsers.length > 0,
      `Data files intact and parsed successfully`
    );
    record(
      'Single hashed administrator credential',
      adminCredentialIsHashed,
      `Administrator accounts: ${adminUsers.length}, bcrypt hash: ${adminCredentialIsHashed}`
    );

    // 16. GitHub Actions workflow file check
    const ciFile = path.join(projectRoot, '.github', 'workflows', 'ci.yml');
    const ciContent = fs.existsSync(ciFile) ? fs.readFileSync(ciFile, 'utf8') : '';
    record(
      'GitHub Actions',
      fs.existsSync(ciFile) && ciContent.includes('npm run lint') && ciContent.includes('npm run build'),
      `CI workflow exists and includes type check and build steps`
    );

  } finally {
    server.close();
  }

  console.log('\n--- Test Summary ---');
  const allPassed = results.every(r => r.passed);
  console.log(`Total tests: ${results.length}, Passed: ${results.filter(r => r.passed).length}, Failed: ${results.filter(r => !r.passed).length}`);
  if (allPassed) {
    console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  } else {
    console.error('SOME TESTS FAILED!');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
