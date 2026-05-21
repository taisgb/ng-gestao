import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import './styles.scss';

const emptyForm = {
  client_id: '',
  title: '',
  description: '',
  base_value: '',
  payment_type: 'fixo',
  deadline: '',
  scope: 'individual',
  team_id: '',
  member_ids: []
};
const ROLE_LABELS = {
  owner: 'Dono',
  admin: 'Administrador',
  gestor: 'Gestor',
  financeiro: 'Financeiro',
  member: 'Colaborador'
};

export default function ModalProject({ isOpen, onClose, onSuccess }) {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [teams, setTeams] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [formData, setFormData] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    async function loadOptions() {
      try {
        const [clientsRes, teamsRes] = await Promise.all([
          api.get('/clients'),
          api.get('/teams')
        ]);
        setClients(clientsRes.data);
        setTeams(teamsRes.data);
      } catch (err) {
        setError('Não foi possível carregar clientes e times.');
      }
    }

    loadOptions();
  }, [isOpen]);

  useEffect(() => {
    if (!formData.team_id || formData.scope !== 'team') {
      setTeamMembers([]);
      return;
    }

    async function loadTeamMembers() {
      try {
        const response = await api.get(`/teams/${formData.team_id}/members`);
        setTeamMembers(
          response.data.filter(member =>
            member.status === 'active'
            && member.user_id
            && Number(member.user_id) !== Number(user?.id)
          )
        );
      } catch (err) {
        setError('Não foi possível carregar os membros do time.');
      }
    }

    loadTeamMembers();
  }, [formData.team_id, formData.scope, user?.id]);

  if (!isOpen) return null;

  function resetForm() {
    setFormData(emptyForm);
    setTeamMembers([]);
  }

  function handleScopeChange(scope) {
    setFormData(current => ({
      ...current,
      scope,
      team_id: '',
      member_ids: []
    }));
  }

  function toggleMember(memberId) {
    setFormData(current => {
      const exists = current.member_ids.includes(memberId);
      return {
        ...current,
        member_ids: exists
          ? current.member_ids.filter(id => id !== memberId)
          : [...current.member_ids, memberId]
      };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await api.post('/projects', {
        ...formData,
        team_id: formData.scope === 'team' ? formData.team_id : null,
        member_ids: formData.scope === 'team' ? formData.member_ids : []
      });

      resetForm();
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar projeto.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <header>
          <h2>Iniciar Novo Projeto</h2>
          <button onClick={onClose} className="btn-close">x</button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Título do Projeto *</label>
            <input
              required
              placeholder="Ex: Identidade Visual - Cafe do Porto"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
            />
          </div>

          <div className="input-group">
            <label>Cliente *</label>
            <select
              required
              value={formData.client_id}
              onChange={e => setFormData({ ...formData, client_id: e.target.value })}
            >
              <option value="">Selecione um cliente</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>
                  {client.name}{client.team_name ? ` - Time: ${client.team_name}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="input-group">
            <label>Tipo de projeto</label>
            <div className="scope-options">
              <button
                type="button"
                className={formData.scope === 'individual' ? 'active' : ''}
                onClick={() => handleScopeChange('individual')}
              >
                Individual
              </button>
              <button
                type="button"
                className={formData.scope === 'team' ? 'active' : ''}
                onClick={() => handleScopeChange('team')}
              >
                De equipe
              </button>
            </div>
            <p className="scope-hint">
              {formData.scope === 'individual'
                ? 'Este projeto será visível apenas para você.'
                : 'Escolha quais membros participarao deste projeto.'}
            </p>
          </div>

          {formData.scope === 'team' && (
            <>
              <div className="input-group">
                <label>Time *</label>
                <select
                  required
                  value={formData.team_id}
                  onChange={e => setFormData({ ...formData, team_id: e.target.value, member_ids: [] })}
                >
                  <option value="">Selecione o time</option>
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </div>

              {formData.team_id && (
                <div className="input-group">
                  <label>Membros do projeto</label>
                  <div className="member-picker">
                    {teamMembers.map(member => (
                      <label key={member.id}>
                        <input
                          type="checkbox"
                          checked={formData.member_ids.includes(member.user_id)}
                          onChange={() => toggleMember(member.user_id)}
                        />
                        <span>{member.name || member.email}</span>
                        <small>{ROLE_LABELS[member.role] || member.role}</small>
                      </label>
                    ))}
                    {teamMembers.length === 0 && <p>Nenhum outro membro ativo neste time.</p>}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="input-row">
            <div className="input-group">
              <label>Valor Estimado (R$)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.base_value}
                onChange={e => setFormData({ ...formData, base_value: e.target.value })}
              />
            </div>
            <div className="input-group">
              <label>Prazo de Entrega</label>
              <input
                type="date"
                value={formData.deadline}
                onChange={e => setFormData({ ...formData, deadline: e.target.value })}
              />
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-cancel">Cancelar</button>
            <button type="submit" className="btn-save" disabled={isSubmitting}>
              {isSubmitting ? 'Criando...' : 'Confirmar Projeto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
