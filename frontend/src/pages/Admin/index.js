import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import './styles.scss';

const CATEGORY_OPTIONS = [
  { value: 'convidado', label: 'Convidado' },
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'admin', label: 'Admin' }
];

export default function Admin() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [inviteForm, setInviteForm] = useState({ email: '', plan: 'convidado' });
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  const isAdmin = user?.plan === 'admin';

  const loadAdminData = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    try {
      const [usersRes, invitationsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/invitations')
      ]);
      setUsers(usersRes.data);
      setInvitations(invitationsRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar painel admin.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  async function handleInvite(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/admin/invitations', inviteForm);
      setInviteForm({ email: '', plan: 'convidado' });
      await loadAdminData();
      setFeedback('Convite registrado. O usuario ja pode se cadastrar com esse email.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao registrar convite.');
    }
  }

  async function handleChangeCategory(targetUser, plan) {
    setFeedback('');

    try {
      await api.put('/admin/promote', { email: targetUser.email, newPlan: plan });
      setUsers(current => current.map(item => item.id === targetUser.id ? { ...item, plan } : item));
      setFeedback(`Categoria de ${targetUser.name} atualizada.`);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar categoria.');
    }
  }

  function categoryLabel(plan) {
    return CATEGORY_OPTIONS.find(option => option.value === plan)?.label || plan;
  }

  return (
    <div className="admin-container">
      <header className="page-header">
        <div>
          <h1>Administracao</h1>
          <p>Controle convites e categorias dos usuarios da equipe.</p>
        </div>
      </header>

      {!isAdmin && (
        <div className="blocked-panel">
          <strong>Acesso restrito</strong>
          <p>Esta area exige uma conta com categoria admin.</p>
        </div>
      )}

      {feedback && <div className="feedback-message">{feedback}</div>}

      {isAdmin && (
        <>
          <section className="admin-panel">
            <h2>Novo convite</h2>
            <form onSubmit={handleInvite}>
              <input
                type="email"
                value={inviteForm.email}
                onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder="email do convidado"
                required
              />
              <select value={inviteForm.plan} onChange={e => setInviteForm({ ...inviteForm, plan: e.target.value })}>
                {CATEGORY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button type="submit">Criar convite</button>
            </form>
          </section>

          <section className="admin-panel">
            <h2>Usuarios</h2>
            {loading ? (
              <p className="empty-text">Carregando usuarios...</p>
            ) : (
              <div className="admin-list">
                {users.map(item => (
                  <article key={item.id} className="admin-row">
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.email}</span>
                    </div>
                    <select value={item.plan} onChange={e => handleChangeCategory(item, e.target.value)}>
                      {CATEGORY_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="admin-panel">
            <h2>Convites</h2>
            <div className="admin-list">
              {invitations.map(invitation => (
                <article key={invitation.id} className="admin-row">
                  <div>
                    <strong>{invitation.email}</strong>
                    <span>
                      {invitation.accepted_at ? 'Aceito' : 'Pendente'} - Categoria {categoryLabel(invitation.plan)}
                    </span>
                  </div>
                  <small>{new Date(invitation.created_at).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</small>
                </article>
              ))}
              {invitations.length === 0 && <p className="empty-text">Nenhum convite registrado.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
