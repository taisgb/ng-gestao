import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

const emptyForm = { name: '', default_price: '', description: '', scope: 'individual', team_id: '' };

function parseCurrency(value) {
  if (typeof value === 'number') return value;
  const normalized = String(value || '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

export default function Services() {
  const [services, setServices] = useState([]);
  const [teams, setTeams] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [form, setForm] = useState(emptyForm);
  const [editingService, setEditingService] = useState(null);

  const loadServices = useCallback(async (status = statusFilter) => {
    try {
      const [servicesRes, teamsRes] = await Promise.all([
        api.get(`/services?status=${status}`),
        api.get('/teams')
      ]);
      setServices(servicesRes.data);
      setTeams(teamsRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar servicos.');
    }
  }, [statusFilter]);

  useEffect(() => {
    loadServices(statusFilter);
  }, [loadServices, statusFilter]);

  function resetForm() {
    setForm(emptyForm);
    setEditingService(null);
  }

  function startEdit(service) {
    setEditingService(service);
    setForm({
      name: service.name || '',
      default_price: String(service.default_value ?? service.default_price ?? ''),
      description: service.description || '',
      scope: service.team_id ? 'team' : 'individual',
      team_id: service.team_id || ''
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFeedback('');

    const payload = {
      name: form.name,
      default_value: parseCurrency(form.default_price),
      description: form.description,
      team_id: form.scope === 'team' ? form.team_id : null
    };

    try {
      if (editingService) {
        await api.put(`/services/${editingService.id}`, payload);
        setFeedback('Servico atualizado.');
      } else {
        await api.post('/services', payload);
        setFeedback('Servico cadastrado.');
      }

      resetForm();
      await loadServices();
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar servico.');
    }
  }

  async function handleArchive(service) {
    const confirmed = window.confirm('Deseja arquivar este servico? Ele podera ser restaurado depois.');
    if (!confirmed) return;

    try {
      await api.patch(`/services/${service.id}/archive`);
      await loadServices();
      setFeedback('Servico arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar servico.');
    }
  }

  async function handleRestore(service) {
    try {
      await api.patch(`/services/${service.id}/restore`);
      await loadServices();
      setFeedback('Servico restaurado com sucesso.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao restaurar servico.');
    }
  }

  const formatCurrency = value =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

  return (
    <div className="services-container">
      <header className="page-header">
        <div>
          <h1>Servicos</h1>
          <p>Catalogo de categorias que voce usa nos projetos e propostas.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="service-form">
        <form onSubmit={handleSubmit}>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nome do servico" required />
          <input value={form.default_price} onChange={e => setForm({ ...form, default_price: e.target.value })} placeholder="Valor padrao" />
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descricao curta" />
          <select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value, team_id: '' })}>
            <option value="individual">Servico individual</option>
            <option value="team">Servico de time</option>
          </select>
          {form.scope === 'team' && (
            <select value={form.team_id} onChange={e => setForm({ ...form, team_id: e.target.value })} required>
              <option value="">Selecione o time</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          )}
          <button type="submit">{editingService ? 'Salvar alteracoes' : 'Adicionar'}</button>
          {editingService && <button type="button" className="btn-cancel" onClick={resetForm}>Cancelar edicao</button>}
        </form>
      </section>

      <div className="service-tabs">
        {[
          ['active', 'Ativos'],
          ['archived', 'Arquivados'],
          ['all', 'Todos']
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={statusFilter === value ? 'active' : ''}
            onClick={() => setStatusFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="services-list">
        {services.map(service => (
          <article key={service.id} className={`service-card ${service.archived === 1 ? 'archived' : ''}`}>
            <div>
              <strong>{service.name}</strong>
              <p>{service.description || 'Sem descricao'}</p>
              <div className="service-badges">
                <small>{service.team_id ? `Time: ${service.team_name}` : 'Individual'}</small>
                {service.archived === 1 && <small className="archived-badge">Arquivado</small>}
              </div>
            </div>
            <div className="service-meta">
              <span>{formatCurrency(service.default_value ?? service.default_price)}</span>
              {service.can_edit ? (
                <>
                  {service.archived !== 1 && <button onClick={() => startEdit(service)}>Editar</button>}
                  {service.archived !== 1 && <button className="danger" onClick={() => handleArchive(service)}>Arquivar</button>}
                  {service.archived === 1 && <button className="restore" onClick={() => handleRestore(service)}>Restaurar</button>}
                </>
              ) : (
                <button disabled>Somente leitura</button>
              )}
            </div>
          </article>
        ))}
        {services.length === 0 && <p className="empty-msg">Nenhum servico encontrado.</p>}
      </section>
    </div>
  );
}
