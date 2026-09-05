import { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [merchant, setMerchant] = useState(() => {
    const stored = localStorage.getItem('merchant');
    return stored ? JSON.parse(stored) : null;
  });

  function persist(data) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    if (data.merchant) {
      localStorage.setItem('merchant', JSON.stringify(data.merchant));
      setMerchant(data.merchant);
    }
  }

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    persist(data);
    return data.user;
  }, []);

  const register = useCallback(async (payload, adminKey) => {
    const data = await api.register(payload, adminKey);
    persist(data);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('merchant');
    setUser(null);
    setMerchant(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, merchant, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
}
