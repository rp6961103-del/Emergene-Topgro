import { Router, Request, Response } from 'express';
import { db } from '../services/db.ts';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.ts';
import { logger } from '../utils/logger.ts';
import { AppRequest } from '../middleware/logging.ts';

const router = Router();

// GET /api/orders - Admin get all orders
router.get('/', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  try {
    const orders = db.orders.getAll();
    logger.info(`Admin fetched orders: ${orders.length} records`, { requestId, userId: req.user?.id });
    res.json(orders);
  } catch (err: any) {
    logger.error('Failed to retrieve orders', err, { requestId });
    res.status(500).json({
      error: 'Failed to retrieve orders',
      code: 'ORDERS_FETCH_FAILED',
      requestId
    });
  }
});

// GET /api/orders/my-orders - Customer get own orders
router.get('/my-orders', authenticate, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'UNAUTHENTICATED',
      requestId
    });
  }

  try {
    const orders = db.orders.getAll();
    const userOrders = orders.filter(
      o => (o.customer && o.customer.userId === req.user!.id) || 
           (o.customer && o.customer.email.toLowerCase() === req.user!.email.toLowerCase())
    );
    logger.info(`Customer fetched own orders: ${userOrders.length} records for ${req.user.email}`, {
      requestId,
      userId: req.user.id
    });
    res.json(userOrders);
  } catch (err: any) {
    logger.error('Failed to retrieve customer orders', err, { requestId });
    res.status(500).json({
      error: 'Failed to retrieve your orders',
      code: 'MY_ORDERS_FETCH_FAILED',
      requestId
    });
  }
});

// GET /api/orders/lookup/:identifier - Track order by Order Number or ID
router.get('/lookup/:identifier', (req: Request, res: Response) => {
  const requestId = (req as AppRequest).id || 'unknown';
  const order = db.orders.getById(req.params.identifier);
  if (!order) {
    return res.status(404).json({
      error: 'Order not found with provided reference',
      code: 'ORDER_NOT_FOUND',
      requestId
    });
  }
  res.json(order);
});

// POST /api/orders - Create new order (guest or authenticated)
router.post('/', (req: Request, res: Response) => {
  const requestId = (req as AppRequest).id || 'unknown';
  try {
    const { items, customer, shippingAddress, subtotal, deliveryCharge, tax, total, paymentMethod } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Order must contain at least one item',
        code: 'ORDER_ITEMS_EMPTY',
        requestId
      });
    }

    if (!customer || !customer.name || !customer.phone) {
      return res.status(400).json({
        error: 'Customer name and phone number are required',
        code: 'CUSTOMER_INFO_MISSING',
        requestId
      });
    }

    if (!shippingAddress || !shippingAddress.address || !shippingAddress.city || !shippingAddress.pinCode) {
      return res.status(400).json({
        error: 'Complete shipping address (address, city, pin code) is required',
        code: 'SHIPPING_ADDRESS_INCOMPLETE',
        requestId
      });
    }

    // Deduct stock if necessary
    for (const item of items) {
      const prod = db.products.getById(item.productId) || db.products.getBySlug(item.slug);
      if (prod && prod.stock >= item.quantity) {
        db.products.update(prod._id, { stock: Math.max(0, prod.stock - item.quantity) });
      }
    }

    const newOrder = db.orders.create({
      customer,
      items,
      shippingAddress,
      subtotal: Number(subtotal) || 0,
      deliveryCharge: Number(deliveryCharge) || 0,
      tax: Number(tax) || 0,
      total: Number(total) || 0,
      paymentMethod: paymentMethod || 'Cash on Delivery',
      paymentStatus: paymentMethod === 'Cash on Delivery' ? 'Pending' : 'Paid',
      orderStatus: 'Order Placed'
    });

    logger.info(`Order placed successfully: ${newOrder.orderNumber} (₹${newOrder.total})`, {
      requestId,
      orderNumber: newOrder.orderNumber
    });

    res.status(201).json(newOrder);
  } catch (err: any) {
    logger.error('Failed to create order', err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to place order',
      code: 'ORDER_CREATE_FAILED',
      requestId
    });
  }
});

// PUT /api/orders/:id/status - Admin update order status
router.put('/:id/status', requireAdmin, (req: AuthRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  const { status, notes } = req.body;
  if (!status) {
    return res.status(400).json({
      error: 'Order status is required',
      code: 'STATUS_REQUIRED',
      requestId
    });
  }

  const validStatuses = [
    'Order Placed',
    'Confirmed',
    'Processing',
    'Shipped',
    'Out for Delivery',
    'Delivered',
    'Cancelled'
  ];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      code: 'INVALID_ORDER_STATUS',
      requestId
    });
  }

  try {
    const updated = db.orders.updateStatus(req.params.id, status, notes);
    if (!updated) {
      return res.status(404).json({
        error: 'Order not found',
        code: 'ORDER_NOT_FOUND',
        requestId
      });
    }

    logger.info(`Order ${updated.orderNumber} status updated to '${status}' by admin`, {
      requestId,
      userId: req.user?.id
    });

    res.json(updated);
  } catch (err: any) {
    logger.error(`Failed to update status for order ${req.params.id}`, err, { requestId });
    res.status(500).json({
      error: err.message || 'Failed to update order status',
      code: 'ORDER_STATUS_UPDATE_FAILED',
      requestId
    });
  }
});

export default router;
