import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../services/api';
import './styles.scss';

export default function ProjectDetails() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [finance, setFinance] = useState(null);
  const [totalValueDraft, setTotalValueDraft] = useState('');
  const [shareDrafts, setShareDrafts] = useState({});
  const [statuses, setStatuses] = useState([]);
  const [members, setMembers] = useState([]);
  const [notes, setNotes] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [newNote, setNewNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  const loadProjectData = useCallback(async () => {
    try {
      const [projRes, tasksRes, transRes, financeRes, statusesRes, membersRes, notesRes] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/tasks?project_id=${id}`),
        api.get(`/transactions?project_id=${id}`),
        api.get(`/projects/${id}/finance`),
        api.get(`/projects/${id}/statuses`),
        api.get(`/projects/${id}/members`),
        api.get(`/projects/${id}/notes`)
      ]);

      setProject(projRes.data);
      setTasks(tasksRes.data);
      setTransactions(transRes.data);
      setFinance(financeRes.data);
      setTotalValueDraft(String(financeRes.data.total_value || ''));
      setShareDrafts(
        financeRes.data.shares.reduce((acc, share) => {
          acc[share.user_id] = String(share.amount || '');
          return acc;
        }, {})
      );
      setStatuses(statusesRes.data);
      setMembers(membersRes.data);
      setNotes(notesRes.data);
    } catch (err) {
      console.error('Erro ao carregar detalhes do projeto', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProjectData();
  }, [loadProjectData]);

  async function handleStatusChange(status) {
    setFeedback('');

    try {
      await api.put(`/projects/${id}`, { status });
      setProject(current => ({ ...current, status }));
      setFeedback('Status atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar status.');
    }
  }

  async function handleAddStatus(e) {
    e.preventDefault();
    setFeedback('');

    try {
      const response = await api.post(`/projects/${id}/statuses`, { name: newStatus });
      setStatuses(current => [...current, response.data]);
      setNewStatus('');
      setFeedback('Status adicionado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao criar status.');
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post(`/projects/${id}/share`, { email: inviteEmail });
      setInviteEmail('');
      await loadProjectData();
      setFeedback('Colaborador adicionado ao projeto.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao compartilhar projeto.');
    }
  }

  async function handleAddNote(e) {
    e.preventDefault();
    setFeedback('');

    try {
      const response = await api.post(`/projects/${id}/notes`, { note: newNote });
      setNotes(current => [response.data, ...current]);
      setNewNote('');
      setFeedback('Anotacao registrada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao registrar anotacao.');
    }
  }

  async function handleSaveFinance(e) {
    e.preventDefault();
    setFeedback('');

    try {
      const editableShares = finance.shares
        .filter(share => share.can_edit)
        .map(share => ({
          user_id: share.user_id,
          amount: Number(shareDrafts[share.user_id] || 0)
        }));

      await api.put(`/projects/${id}/finance`, {
        ...(finance.can_edit_total ? { total_value: Number(totalValueDraft || 0) } : {}),
        shares: editableShares
      });

      await loadProjectData();
      setFeedback('Divisao financeira atualizada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar divisao financeira.');
    }
  }

  if (loading) return <div className="loading">Carregando detalhes...</div>;
  if (!project) return <div className="error">Projeto nao encontrado.</div>;

  const totalIncome = transactions
    .filter(t => t.type === 'Receita')
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const totalExpense = transactions
    .filter(t => t.type === 'Despesa')
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const formatCurrency = value =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

  return (
    <div className="project-details-container">
      <header className="details-header">
        <div>
          <h1>{project.title}</h1>
          <p>Cliente: <strong>{project.client_name}</strong></p>
        </div>
        <div className="project-badge">{project.status}</div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="project-summary">
        <div className="summary-item">
          <span>Valor do Contrato</span>
          <strong>{formatCurrency(finance?.total_value ?? project.base_value)}</strong>
        </div>
        <div className="summary-item">
          <span>Meu Recebido</span>
          <strong className="income">{formatCurrency(totalIncome)}</strong>
        </div>
        <div className="summary-item">
          <span>Prazo</span>
          <strong>{project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Flexivel'}</strong>
        </div>
      </section>

      {finance && (
        <section className="finance-split-section">
          <div className="split-header">
            <div>
              <h2>Divisao financeira</h2>
              <p>{formatCurrency(finance.allocation_total)} distribuido de {formatCurrency(finance.total_value)}</p>
            </div>
            <span className={finance.unallocated_amount === 0 ? 'balanced' : 'pending'}>
              {finance.unallocated_amount === 0 ? 'Fechado' : `${formatCurrency(finance.unallocated_amount)} sem dividir`}
            </span>
          </div>

          <form onSubmit={handleSaveFinance} className="split-form">
            <div className="total-field">
              <label>Valor total do projeto</label>
              <input
                type="number"
                step="0.01"
                value={totalValueDraft}
                disabled={!finance.can_edit_total}
                onChange={e => setTotalValueDraft(e.target.value)}
              />
            </div>

            <div className="share-list">
              {finance.shares.map(share => (
                <div key={share.user_id} className="share-row">
                  <div>
                    <strong>{share.name}</strong>
                    <span>{share.role === 'owner' ? 'Dono' : 'Colaborador'} - {share.percentage.toFixed(1)}%</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={shareDrafts[share.user_id] || ''}
                    disabled={!share.can_edit}
                    onChange={e => setShareDrafts(current => ({
                      ...current,
                      [share.user_id]: e.target.value
                    }))}
                  />
                </div>
              ))}
            </div>

            <button type="submit">Salvar divisao</button>
          </form>
        </section>
      )}

      <section className="collaboration-panel">
        <div className="panel-section">
          <h2>Status do projeto</h2>
          <div className="status-options">
            {statuses.map(status => (
              <button
                key={status.id}
                type="button"
                className={project.status === status.name ? 'active' : ''}
                onClick={() => handleStatusChange(status.name)}
              >
                {status.name}
              </button>
            ))}
          </div>

          <form onSubmit={handleAddStatus} className="inline-form">
            <input
              value={newStatus}
              onChange={e => setNewStatus(e.target.value)}
              placeholder="Novo status"
            />
            <button type="submit">Adicionar</button>
          </form>
        </div>

        <div className="panel-section">
          <h2>Compartilhamento</h2>
          <form onSubmit={handleInvite} className="inline-form">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="email@exemplo.com"
            />
            <button type="submit">Convidar</button>
          </form>

          <div className="members-list">
            {members.map(member => (
              <div key={`${member.role}-${member.id}`} className="member-item">
                <strong>{member.name}</strong>
                <span>{member.role === 'owner' ? 'Dono' : 'Colaborador'}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="details-grid">
        <section className="details-section">
          <h2>Tarefas do Projeto</h2>
          <div className="tasks-mini-list">
            {tasks.length > 0 ? tasks.map(task => (
              <div key={task.id} className="task-item">
                <input type="checkbox" checked={task.status === 'concluido' || task.status === 'concluído'} readOnly />
                <span>{task.title}</span>
              </div>
            )) : <p className="empty">Nenhuma tarefa criada.</p>}
          </div>
        </section>

        <section className="details-section">
          <h2>Meu Financeiro no Projeto</h2>
          <div className="private-summary">
            <span>Entradas: {formatCurrency(totalIncome)}</span>
            <span>Saidas: {formatCurrency(totalExpense)}</span>
          </div>
          <div className="finance-mini-list">
            {transactions.map(t => (
              <div key={t.id} className={`finance-item ${t.type.toLowerCase()}`}>
                <span>{t.description}</span>
                <strong>{t.type === 'Despesa' ? '-' : '+'} {formatCurrency(t.amount)}</strong>
              </div>
            ))}
            {transactions.length === 0 && <p className="empty">Sem lancamentos individuais.</p>}
          </div>
        </section>
      </div>

      <section className="notes-section">
        <h2>Anotacoes de andamento</h2>
        <form onSubmit={handleAddNote} className="note-form">
          <textarea
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            placeholder="Registre uma decisao, pendencia ou atualizacao importante..."
            rows="4"
          />
          <button type="submit">Registrar anotacao</button>
        </form>

        <div className="notes-list">
          {notes.map(note => (
            <article key={note.id} className="note-item">
              <p>{note.note}</p>
              <span>
                {note.author_name} - {new Date(note.created_at).toLocaleString('pt-BR')}
              </span>
            </article>
          ))}
          {notes.length === 0 && <p className="empty">Nenhuma anotacao ainda.</p>}
        </div>
      </section>
    </div>
  );
}
