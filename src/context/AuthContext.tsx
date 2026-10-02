import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback
} from 'react';
import { User } from '../types/index.ts';
import { api, setOnUnauthorizedHandler, ApiError } from '../services/api.ts';

export type AuthStatus = 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';

interface AuthContextType {
  user: User | null;
  token: string | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  isAdmin: boolean;
  loading: boolean;
  login: (email: string, pass: string) => Promise<User>;
  register: (
    name: string,
    email: string,
    pass: string,
    phone?: string
  ) => Promise<User>;
  adminLogin: (username: string, pass: string) => Promise<User>;
  logout: () => void;
  invalidateSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  // Always begin with user = null; do not trust unverified localStorage data
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('et_auth_token');
    } catch {
      return null;
    }
  });

  const [status, setStatus] = useState<AuthStatus>('INITIALIZING');

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    setStatus('UNAUTHENTICATED');

    try {
      localStorage.removeItem('et_auth_token');
      localStorage.removeItem('et_auth_user');
    } catch (e) {
      console.warn('Failed to clear storage credentials:', e);
    }
  }, []);

  // Hook global 401 unauthorized handler from API client
  useEffect(() => {
    setOnUnauthorizedHandler((_err: ApiError) => {
      console.warn('API returned 401 Unauthorized - invalidating active session');
      clearSession();
    });

    return () => {
      setOnUnauthorizedHandler(null);
    };
  }, [clearSession]);

  // Session verification on mount or token change
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      const storedToken = localStorage.getItem('et_auth_token');

      if (!storedToken) {
        if (!cancelled) {
          clearSession();
        }
        return;
      }

      setStatus('INITIALIZING');

      try {
        const currentUser = await api.getCurrentUser();

        if (cancelled) return;

        setUser(currentUser);
        setToken(storedToken);
        setStatus('AUTHENTICATED');

        try {
          localStorage.setItem('et_auth_user', JSON.stringify(currentUser));
        } catch {}
      } catch (error) {
        console.warn('Session verification rejected by server:', error);

        if (!cancelled) {
          clearSession();
        }
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = async (email: string, pass: string): Promise<User> => {
    const response = await api.login(email, pass);

    setUser(response.user);
    setToken(response.token);
    setStatus('AUTHENTICATED');

    try {
      localStorage.setItem('et_auth_token', response.token);
      localStorage.setItem('et_auth_user', JSON.stringify(response.user));
    } catch {}

    return response.user;
  };

  const register = async (
    name: string,
    email: string,
    pass: string,
    phone?: string
  ): Promise<User> => {
    const response = await api.register(name, email, pass, phone);

    setUser(response.user);
    setToken(response.token);
    setStatus('AUTHENTICATED');

    try {
      localStorage.setItem('et_auth_token', response.token);
      localStorage.setItem('et_auth_user', JSON.stringify(response.user));
    } catch {}

    return response.user;
  };

  const adminLogin = async (username: string, pass: string): Promise<User> => {
    const response = await api.adminLogin(username, pass);

    // Verify received user role
    if (response.user.role !== 'admin') {
      clearSession();
      throw new Error('Access denied: Account is not an administrator');
    }

    setUser(response.user);
    setToken(response.token);
    setStatus('AUTHENTICATED');

    try {
      localStorage.setItem('et_auth_token', response.token);
      localStorage.setItem('et_auth_user', JSON.stringify(response.user));
    } catch {}

    return response.user;
  };

  const logout = () => {
    clearSession();
  };

  const loading = status === 'INITIALIZING';
  const isAuthenticated = status === 'AUTHENTICATED' && user !== null;
  const isAdmin = isAuthenticated && user?.role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        status,
        isAuthenticated,
        isAdmin,
        loading,
        login,
        register,
        adminLogin,
        logout,
        invalidateSession: clearSession
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
};
