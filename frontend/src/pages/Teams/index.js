import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

const ROLES = ['admin', 'gestor', 'member'];
const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  gestor: 'Gestor',
  member: 'Membro'
};

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState({ name: '', description: '' });
  const [invite, setInvite] = useState({ email: '', role: 'member' });
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  const loadTeams = useCallback(async () => {
    try {
      const response = await api.get('/teams');
      setTeams(response.data);
      setSelectedTeam(current => current || response.data[0] || null);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar times.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async (teamId) => {
    if (!teamId) return;
    try {
      const response = await api.get(`/teams/${teamId}/members`);
      setMembers(response.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar membros.');
    }
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    loadMembers(selectedTeam?.id);
  }, [loadMembers, selectedTeam?.id]);

  async function handleCreate(e) {
    e.preventDefault();
    setFeedback('');

    try {
      const response = await api.post('/teams', form);
      setForm({ name: '', description: '' });
      await loadTeams();
      const created = await api.get(`/teams/${response.data.id}`);
      setSelectedTeam(created.data);
      setFeedback('Time criado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao criar time.');
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!selectedTeam) return;
    setFeedback('');

    try {
      await api.post(`/teams/${selectedTeam.id}/members`, invite);
      setInvite({ email: '', role: 'member' });
      await loadMembers(selectedTeam.id);
      setFeedback('Membro adicionado ou convite pendente registrado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao adicionar membro.');
    }
  }

  async function handleRole(member, role) {
    try {
      await api.put(`/teams/${selectedTeam.id}/members/${member.id}`, { role });
      await loadMembers(selectedTeam.id);
      setFeedback('Papel atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar membro.');
    }
  }

  async function handleRemove(member) {
    try {
      await api.delete(`/teams/${selectedTeam.id}/members/${member.id}`);
      await loadMembers(selectedTeam.id);
      setFeedback('Membro removido.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao remover membro.');
    }
  }

  const canManage = ['owner', 'admin'].includes(selectedTeam?.my_role);

  return (
    <div className="teams-container">
      <header className="page-header">
        <div>
          <h1>Times</h1>
          <p>Equipes que compartilham clientes, projetos, servicos e agenda.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="team-form-panel">
        <form onSubmit={handleCreate}>
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Nome do time"
            required
          />
          <input
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Descricao"
          />
          <button type="submit">Criar time</button>
        </form>
      </section>

      <div className="teams-layout">
        <aside className="team-list">
          {loading && <p>Carregando...</p>}
          {teams.map(team => (
            <button
              key={team.id}
              type="button"
              className={selectedTeam?.id === team.id ? 'active' : ''}
              onClick={() => setSelectedTeam(team)}
            >
              <strong>{team.name}</strong>
              <span>{ROLE_LABELS[team.my_role] || team.my_role}</span>
            </button>
          ))}
          {!loading && teams.length === 0 && <p className="empty-msg">Nenhum time criado ainda.</p>}
        </aside>

        <section className="team-details">
          {selectedTeam ? (
            <>
              <div className="team-title">
                <div>
                  <h2>{selectedTeam.name}</h2>
                  <p>{selectedTeam.description || 'Sem descricao'}</p>
                </div>
                <span className={`role-badge ${selectedTeam.my_role}`}>{ROLE_LABELS[selectedTeam.my_role]}</span>
              </div>

              {canManage && (
                <form onSubmit={handleInvite} className="invite-form">
                  <input
                    type="email"
                    value={invite.email}
                    onChange={e => setInvite({ ...invite, email: e.target.value })}
                    placeholder="email@exemplo.com"
                    required
                  />
                  <select value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })}>
                    {ROLES.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                  </select>
                  <button type="submit">Adicionar</button>
                </form>
              )}

              <div className="members-table">
                {members.map(member => (
                  <article key={member.id} className="member-row">
                    <div>
                      <strong>{member.name || member.email}</strong>
                      <span>{member.email} - {member.status === 'pending' ? 'Convite pendente' : 'Ativo'}</span>
                    </div>
                    <div className="member-actions">
                      <span className={`role-badge ${member.role}`}>{ROLE_LABELS[member.role]}</span>
                      {canManage && member.role !== 'owner' && (
                        <>
                          <select value={member.role} onChange={e => handleRole(member, e.target.value)}>
                            {ROLES.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                          </select>
                          <button onClick={() => handleRemove(member)}>Remover</button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="empty-msg">Selecione ou crie um time.</p>
          )}
        </section>
      </div>
    </div>
  );
}
