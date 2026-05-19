import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function PrivateRoute() {
  const { signed, loading } = useAuth();

  if (loading) {
    return <div>Carregando sistema...</div>; // Aqui depois podemos colocar um spinner minimalista
  }

  // Se estiver logado (signed = true), renderiza a rota filha (Outlet). Se não, manda pro "/"
  return signed ? <Outlet /> : <Navigate to="/" />;
}