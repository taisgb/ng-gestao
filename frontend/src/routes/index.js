import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import PrivateRoute from './PrivateRoute';
import DefaultLayout from '../pages/_layouts/defaults';

import Login from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import Clients from '../pages/Clients';
import Upgrade from '../pages/Upgrade';
import ProjectDetails from '../pages/ProjectDetails';
import Projects from '../pages/Projects';
import Finance from '../pages/Finance';
import Agenda from '../pages/Agenda';
import Services from '../pages/Services';
import PersonalFinance from '../pages/PersonalFinance';
import Profile from '../pages/Profile';
import Admin from '../pages/Admin';
import Register from '../pages/Register';
import NotFound from '../pages/NotFound';
import Invoices from '../pages/Invoices';
import Teams from '../pages/Teams';
import Documents from '../pages/Documents';

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />

        <Route element={<PrivateRoute />}>
          <Route element={<DefaultLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/clientes" element={<Clients />} />
            <Route path="/times" element={<Teams />} />
            <Route path="/upgrade" element={<Upgrade />} />
            <Route path="/projetos" element={<Projects />} />
            <Route path="/projetos/:id" element={<ProjectDetails />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/financeiro" element={<Finance />} />
            <Route path="/notas-fiscais" element={<Invoices />} />
            <Route path="/documentos" element={<Documents />} />
            <Route path="/financeiro-pessoal" element={<PersonalFinance />} />
            <Route path="/servicos" element={<Services />} />
            <Route path="/perfil" element={<Profile />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
