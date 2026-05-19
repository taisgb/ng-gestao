import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../../../components/SideBar';
import './styles.scss';

export default function DefaultLayout() {
  return (
    <div className="layout-wrapper">
      <Sidebar />
      <main className="layout-content">
        <Outlet /> 
        {/* O Outlet é onde o React Router vai renderizar a página atual (Dashboard, Clientes, etc) */}
      </main>
    </div>
  );
}
