import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  MdAccountBalanceWallet,
  MdAdminPanelSettings,
  MdAssignment,
  MdAttachMoney,
  MdDashboard,
  MdDarkMode,
  MdEventNote,
  MdFolderOpen,
  MdGroups,
  MdHomeRepairService,
  MdLightMode,
  MdLogout,
  MdPeople,
  MdReceiptLong,
  MdSettings,
  MdTaskAlt
} from 'react-icons/md';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import './styles.scss';

export default function Sidebar() {
  const { signOut, user } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const categoryLabel = {
    free: 'Plano Gratuito',
    pro: 'Assinante Pro',
    admin: 'Administrador',
    convidado: 'Convidado'
  };

  const navItems = [
    ['/dashboard', MdDashboard, 'Dashboard'],
    ['/tarefas', MdTaskAlt, 'Tarefas'],
    ['/projetos', MdAssignment, 'Projetos'],
    ['/clientes', MdPeople, 'Clientes'],
    ['/financeiro', MdAttachMoney, 'Financeiro'],
    ['/financeiro-pessoal', MdAccountBalanceWallet, 'Pessoal'],
    ['/documentos', MdFolderOpen, 'Documentos'],
    ['/notas-fiscais', MdReceiptLong, 'NFs'],
    ['/times', MdGroups, 'Times'],
    ['/servicos', MdHomeRepairService, 'Serviços'],
    ['/agenda', MdEventNote, 'Calendario'],
    ['/perfil', MdSettings, 'Config']
  ];

  return (
    <aside className="sidebar-container">
      <div className="logo-section">
        <h2>Gestão NG</h2>
        {['pro', 'admin', 'convidado'].includes(user?.plan) && (
          <span className="badge-pro">{user?.plan === 'convidado' ? 'CONV' : user?.plan?.toUpperCase()}</span>
        )}
      </div>

      <nav className="menu-nav">
        {navItems.map(([to, Icon, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>
            <Icon size={24} />
            <span>{label}</span>
          </NavLink>
        ))}

        {user?.plan === 'admin' && (
          <NavLink to="/admin" className={({ isActive }) => isActive ? 'active' : ''}>
            <MdAdminPanelSettings size={24} />
            <span>Admin</span>
          </NavLink>
        )}
      </nav>

      <footer className="sidebar-footer">
        <div className="user-info">
          <strong>{user?.name?.split(' ')[0]}</strong>
          <p>{categoryLabel[user?.plan] || 'Usuário'}</p>
        </div>
        <button onClick={toggleTheme} title={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}>
          {isDark ? <MdLightMode size={20} /> : <MdDarkMode size={20} />}
        </button>
        <button onClick={signOut} title="Sair do sistema">
          <MdLogout size={20} />
        </button>
      </footer>
    </aside>
  );
}
