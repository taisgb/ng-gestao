import React, { createContext, useState, useEffect } from 'react';
import api from '../services/api';

export const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Quando a aplicação recarrega, verifica se o utilizador já estava logado
    function loadStorageData() {
      const storedUser = localStorage.getItem('@Gestao:user');
      const storedToken = localStorage.getItem('@Gestao:token');

      if (storedUser && storedToken) {
        // Devolve o token para o cabeçalho do Axios
        api.defaults.headers.Authorization = `Bearer ${storedToken}`;
        setUser(JSON.parse(storedUser));
      }
      
      setLoading(false);
    }

    loadStorageData();
  }, []);

  async function signIn({ email, password }) {
    // Faz a chamada para a rota de sessões que criámos no Node.js
    const response = await api.post('/sessions', { email, password });
    
    const { user, token } = response.data;

    // Configura o Axios para usar o token nas próximas requisições
    api.defaults.headers.Authorization = `Bearer ${token}`;

    // Guarda no navegador para não perder o login ao fazer F5
    localStorage.setItem('@Gestao:user', JSON.stringify(user));
    localStorage.setItem('@Gestao:token', token);

    setUser(user);
  }

  function signOut() {
    // Limpa tudo ao sair
    localStorage.removeItem('@Gestao:user');
    localStorage.removeItem('@Gestao:token');
    setUser(null);
  }

  function updateUser(updatedUser) {
    const nextUser = { ...user, ...updatedUser };
    localStorage.setItem('@Gestao:user', JSON.stringify(nextUser));
    setUser(nextUser);
  }

  return (
    <AuthContext.Provider value={{ 
      signed: !!user, 
      user, 
      loading, 
      signIn, 
      signOut,
      updateUser
    }}>
      {children}
    </AuthContext.Provider>
  );
};
