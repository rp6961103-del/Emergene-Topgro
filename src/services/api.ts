import { Product, Category, Order, User, Settings, Enquiry } from '../types/index.ts';
import fallbackProducts from '../data/products.json';
import fallbackCategories from '../data/categories.json';
import fallbackSettings from '../data/settings.json';

const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;

  constructor(message: string, status: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

type UnauthorizedListener = (error: ApiError) => void;
let unauthorizedListener: UnauthorizedListener | null = null;

export function setOnUnauthorizedHandler(handler: UnauthorizedListener | null) {
  unauthorizedListener = handler;
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem('et_auth_token');
  } catch {
    return null;
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit & { requiresAuth?: boolean; skipAuth?: boolean } = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const headers = new Headers(options.headers || {});

  if (!options.skipAuth) {
    const token = getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers
    });
  } catch (netErr: any) {
    throw new ApiError(
      netErr.message || 'Unable to connect to server. Please check your internet connection.',
      0,
      'NETWORK_ERROR'
    );
  }

  if (!res.ok) {
    let errorData: any = null;
    try {
      errorData = await res.json();
    } catch {
      // Not JSON
    }

    const message = errorData?.error || errorData?.message || `Request failed with status ${res.status}`;
    const code = errorData?.code;
    const requestId = errorData?.requestId || res.headers.get('X-Request-Id') || undefined;

    const apiError = new ApiError(message, res.status, code, requestId);

    if (res.status === 401 && unauthorizedListener) {
      unauthorizedListener(apiError);
    }

    throw apiError;
  }

  // Handle empty responses
  if (res.status === 204) {
    return null as unknown as T;
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await res.json();
  }

  return (await res.text()) as unknown as T;
}

export const api = {
  // Products
  async getProducts(params?: {
    search?: string;
    category?: string;
    packSize?: string;
    inStock?: boolean;
    featured?: boolean;
    sortBy?: string;
    page?: number;
    limit?: number;
  }): Promise<{ products: Product[]; total: number; page: number; totalPages: number }> {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.category) query.set('category', params.category);
    if (params?.packSize) query.set('packSize', params.packSize);
    if (params?.inStock) query.set('inStock', 'true');
    if (params?.featured) query.set('featured', 'true');
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));

    try {
      return await request<{ products: Product[]; total: number; page: number; totalPages: number }>(
        `/products?${query.toString()}`
      );
    } catch (err: any) {
      // Only fallback for public browsing if network error occurs
      if (err.status === 0) {
        console.warn('Network unreachable, utilizing static catalog fallback:', err);
        let list = [...(fallbackProducts as unknown as Product[])];
        if (params?.search) {
          const q = params.search.toLowerCase();
          list = list.filter(p => 
            p.name.toLowerCase().includes(q) || 
            p.category.toLowerCase().includes(q) || 
            p.usedFor.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q)
          );
        }
        if (params?.category && params.category !== 'All') {
          list = list.filter(p => p.category.toLowerCase() === params.category!.toLowerCase());
        }
        if (params?.featured) {
          list = list.filter(p => p.featured);
        }
        if (params?.inStock) {
          list = list.filter(p => p.stock > 0);
        }
        return {
          products: list,
          total: list.length,
          page: 1,
          totalPages: 1
        };
      }
      throw err;
    }
  },

  async getProductBySlug(slug: string): Promise<Product> {
    try {
      return await request<Product>(`/products/${encodeURIComponent(slug)}`);
    } catch (err: any) {
      if (err.status === 0) {
        const found = (fallbackProducts as unknown as Product[]).find(p => p.slug === slug || p._id === slug);
        if (found) return found;
      }
      throw err;
    }
  },

  async getCatalogDiagnostic(): Promise<any> {
    return await request<any>('/products/diagnostic');
  },

  async createProduct(data: Partial<Product>): Promise<Product> {
    return await request<Product>('/products', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateProduct(id: string, data: Partial<Product>): Promise<Product> {
    return await request<Product>(`/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async uploadProductImage(
    id: string,
    payload: { imageBase64?: string; imageUrl?: string; filename?: string; setPrimaryOnly?: boolean }
  ): Promise<{ success: boolean; imageUrl: string; product: Product }> {
    return await request<{ success: boolean; imageUrl: string; product: Product }>(
      `/products/${encodeURIComponent(id)}/upload-image`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    );
  },

  async batchUploadImages(
    images: Array<{ name: string; data: string }>
  ): Promise<{ success: boolean; totalProcessed: number; matchedCount: number; results: any[] }> {
    return await request<{ success: boolean; totalProcessed: number; matchedCount: number; results: any[] }>(
      '/products/batch-upload-images',
      {
        method: 'POST',
        body: JSON.stringify({ images })
      }
    );
  },

  async deleteProduct(id: string): Promise<{ success: boolean; message: string }> {
    return await request<{ success: boolean; message: string }>(`/products/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  // Categories
  async getCategories(): Promise<Category[]> {
    try {
      return await request<Category[]>('/categories');
    } catch (err: any) {
      if (err.status === 0) {
        return fallbackCategories as Category[];
      }
      throw err;
    }
  },

  async createCategory(data: Partial<Category>): Promise<Category> {
    return await request<Category>('/categories', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateCategory(id: string, data: Partial<Category>): Promise<Category> {
    return await request<Category>(`/categories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async deleteCategory(id: string): Promise<{ success: boolean; message: string }> {
    return await request<{ success: boolean; message: string }>(`/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  // Orders
  async getOrders(): Promise<Order[]> {
    return await request<Order[]>('/orders');
  },

  async getMyOrders(): Promise<Order[]> {
    return await request<Order[]>('/orders/my-orders');
  },

  async trackOrder(identifier: string): Promise<Order> {
    return await request<Order>(`/orders/lookup/${encodeURIComponent(identifier)}`, {
      skipAuth: true
    });
  },

  async createOrder(data: any): Promise<Order> {
    return await request<Order>('/orders', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateOrderStatus(id: string, status: string, notes?: string): Promise<Order> {
    return await request<Order>(`/orders/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, notes })
    });
  },

  // Auth
  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    return await request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true
    });
  },

  async register(
    name: string,
    email: string,
    password: string,
    phone?: string
  ): Promise<{ user: User; token: string }> {
    return await request<{ user: User; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, phone }),
      skipAuth: true
    });
  },

  async adminLogin(username: string, password: string): Promise<{ user: User; token: string }> {
    return await request<{ user: User; token: string }>('/auth/admin-login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      skipAuth: true
    });
  },

  async getCurrentUser(): Promise<User> {
    return await request<User>('/auth/me');
  },

  // Enquiries
  async getEnquiries(): Promise<Enquiry[]> {
    return await request<Enquiry[]>('/enquiries');
  },

  async submitEnquiry(data: {
    name: string;
    phone: string;
    email?: string;
    subject?: string;
    message: string;
  }): Promise<Enquiry> {
    return await request<Enquiry>('/enquiries', {
      method: 'POST',
      body: JSON.stringify(data),
      skipAuth: true
    });
  },

  async updateEnquiryStatus(id: string, status: 'new' | 'responded'): Promise<Enquiry> {
    return await request<Enquiry>(`/enquiries/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
  },

  // Settings
  async getSettings(): Promise<Settings> {
    try {
      return await request<Settings>('/settings');
    } catch (err: any) {
      if (err.status === 0) {
        return fallbackSettings as unknown as Settings;
      }
      throw err;
    }
  },

  async updateSettings(data: Partial<Settings>): Promise<Settings> {
    return await request<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }
};
