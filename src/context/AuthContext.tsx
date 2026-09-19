import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api.ts';
import type { User } from '../types/index.ts';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (email: string, pass: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('esp32_auth_token'));
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function verifyExistingSession() {
      const storedToken = localStorage.getItem('esp32_auth_token');
      if (!storedToken) {
        setLoading(false);
        return;
      }

      try {
        const res = await api.getMe();
        if (res.success && res.user) {
          setUser(res.user);
        } else {
          localStorage.removeItem('esp32_auth_token');
          setToken(null);
          setUser(null);
        }
      } catch {
        localStorage.removeItem('esp32_auth_token');
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    verifyExistingSession();
  }, []);

  const login = async (email: string, pass: string) => {
    const res = await api.login({ email, password: pass });
    if (res.success && res.token) {
      localStorage.setItem('esp32_auth_token', res.token);
      setToken(res.token);
      setUser(res.user);
    }
  };

  const register = async (email: string, pass: string) => {
    const res = await api.register({ email, password: pass });
    if (res.success && res.token) {
      localStorage.setItem('esp32_auth_token', res.token);
      setToken(res.token);
      setUser(res.user);
    }
  };

  const logout = () => {
    api.logout().catch(() => {});
    localStorage.removeItem('esp32_auth_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
