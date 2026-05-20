import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import './styles.scss';

const doneStatuses = ['concluido', 'concluído', 'concluÃ­do', 'done'];
const sourceLabels = {
  operational: 'Projeto',
  financial: 'Financeiro',
  document: 'Documento',
  invoice: 'NF',
  service: 'Serviço',
  recurring: 'Recorrente'
};
const priorityLabels = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente'
};

const emptyForm = {
  title: '',
  description: '',
  due_date: '',
  task_type: 'operational',
  priority: 'medium',
  project_id: '',
  team_id: ''
};

function isTaskDone(status) {
  return doneStatuses.includes(status) || String(status || '').toLowerCase().startsWith('conclu');
}

export default function Tasks() {
  const { user } = useAuth();
  const [tab, setTab] = useState('list');
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [summary, setSummary] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState({
    source: 'all',
    scope: 'all',
    status: 'all',
    priority: 'all'
  });

  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== 'all') params.set(key, value);
      });

      const [tasksRes, projectsRes, teamsRes, summaryRes] = await Promise.all([
        api.get(`/tasks?${params.toString()}`),
        api.get('/projects?status=all'),
        api.get('/teams'),
        api.get('/tasks/summary')
      ]);

      setTasks(tasksRes.data);
      setProjects(projectsRes.data);
      setTeams(teamsRes.data);
      setSummary(summaryRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar tarefas.');
    }
  }, [filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const calendarTasks = useMemo(() => tasks.filter(task => task.due_date), [tasks]);

  async function handleCreate(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/tasks', {
        ...form,
        project_id: form.project_id || null,
        team_id: form.project_id ? null : form.team_id || null,
        due_date: form.due_date || null
      });
      setForm(emptyForm);
      await loadData();
      setFeedback('Tarefa criada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao criar tarefa.');
    }
  }

  async function patchTask(task, payload, message = 'Tarefa atualizada.') {
    try {
      if (Object.keys(payload).length === 1 && payload.status !== undefined) {
        await api.patch(`/tasks/${task.id}/status`, payload);
      } else {
        await api.put(`/tasks/${task.id}`, payload);
      }
      await loadData();
      setFeedback(message);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar tarefa.');
    }
  }

  async function handleDelete(task) {
    const confirmed = window.confirm('Deseja excluir esta tarefa?');
    if (!confirmed) return;

    try {
      await api.delete(`/tasks/${task.id}`);
      await loadData();
      setFeedback('Tarefa excluida.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao excluir tarefa.');
    }
  }

  function renderTask(task) {
    const done = isTaskDone(task.status);
    const overdue = task.due_date && task.due_date < new Date().toISOString().split('T')[0] && !done;

    return (
      <article key={task.id} className={`task-row ${task.priority} ${overdue ? 'overdue' : ''}`}>
        <div className="task-main">
          <strong>{task.title}</strong>
          <p>{task.description || task.project_title || task.client_name || 'Sem contexto adicional'}</p>
          <div className="task-badges">
            <span>{sourceLabels[task.task_type] || task.task_type}</span>
            <span>{priorityLabels[task.priority] || task.priority}</span>
            <span>{task.scope === 'team' ? `Equipe${task.team_name ? `: ${task.team_name}` : ''}` : 'Individual'}</span>
            {task.project_title && <span>{task.project_title}</span>}
            {overdue && <span className="danger">Atrasada</span>}
          </div>
        </div>

        <div className="task-meta">
          <span>{task.due_date ? new Date(task.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Sem prazo'}</span>
          <span>{task.assigned_name || (Number(task.assigned_to) === Number(user?.id) ? 'Você' : 'Sem responsável')}</span>
          <strong>{done ? 'Concluída' : task.status}</strong>
        </div>

        <div className="task-actions">
          <button onClick={() => patchTask(task, { status: done ? 'pendente' : 'concluído' }, done ? 'Tarefa reaberta.' : 'Tarefa concluida.')}>
            {done ? 'Reabrir' : 'Concluir'}
          </button>
          <button onClick={() => patchTask(task, { assigned_to: user?.id }, 'Tarefa atribuida a voce.')}>Assumir</button>
          <input
            type="date"
            defaultValue={task.due_date || ''}
            onBlur={e => {
              if (e.target.value !== (task.due_date || '')) patchTask(task, { due_date: e.target.value || null }, 'Prazo atualizado.');
            }}
          />
          <button className="danger" onClick={() => handleDelete(task)}>Excluir</button>
        </div>
      </article>
    );
  }

  return (
    <div className="tasks-container">
      <header className="page-header">
        <div>
          <h1>Tarefas</h1>
          <p>Centro operacional para projetos, financeiro, documentos, notas, serviços e times.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      {summary && (
        <section className="task-summary">
          <div><span>Pendentes</span><strong>{summary.pending}</strong></div>
          <div><span>Atrasadas</span><strong>{summary.overdue}</strong></div>
          <div><span>Concluídas</span><strong>{summary.completed}</strong></div>
          <div><span>Semana</span><strong>{summary.week}</strong></div>
          <div><span>Financeiras abertas</span><strong>{summary.financial_open}</strong></div>
        </section>
      )}

      <section className="task-form-panel">
        <form onSubmit={handleCreate}>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Nova tarefa" required />
          <select value={form.task_type} onChange={e => setForm({ ...form, task_type: e.target.value })}>
            <option value="operational">Operacional</option>
            <option value="financial">Financeira</option>
            <option value="document">Documento</option>
            <option value="invoice">Nota fiscal</option>
            <option value="service">Serviço</option>
            <option value="recurring">Recorrente</option>
          </select>
          <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Baixa</option>
            <option value="medium">Média</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </select>
          <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
          <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value, team_id: '' })}>
            <option value="">Sem projeto</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
          <select value={form.team_id} disabled={Boolean(form.project_id)} onChange={e => setForm({ ...form, team_id: e.target.value })}>
            <option value="">Individual</option>
            {teams.map(team => <option key={team.id} value={team.id}>Time: {team.name}</option>)}
          </select>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descrição opcional" />
          <button type="submit">Criar</button>
        </form>
      </section>

      <div className="task-tabs">
        <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>Lista</button>
        <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>Calendário</button>
      </div>

      <section className="task-filters">
        <select value={filters.source} onChange={e => setFilters({ ...filters, source: e.target.value })}>
          <option value="all">Todas as origens</option>
          <option value="project">Projeto</option>
          <option value="financial">Financeiro</option>
          <option value="document">Documento</option>
          <option value="invoice">Nota fiscal</option>
          <option value="service">Serviço</option>
        </select>
        <select value={filters.scope} onChange={e => setFilters({ ...filters, scope: e.target.value })}>
          <option value="all">Todos os escopos</option>
          <option value="mine">Minhas</option>
          <option value="team">Equipe</option>
          <option value="individual">Individuais</option>
        </select>
        <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="all">Todos os status</option>
          <option value="pending">Pendentes</option>
          <option value="in_progress">Em andamento</option>
          <option value="done">Concluídas</option>
          <option value="overdue">Atrasadas</option>
        </select>
        <select value={filters.priority} onChange={e => setFilters({ ...filters, priority: e.target.value })}>
          <option value="all">Todas prioridades</option>
          <option value="low">Baixa</option>
          <option value="medium">Média</option>
          <option value="high">Alta</option>
          <option value="urgent">Urgente</option>
        </select>
      </section>

      {tab === 'list' ? (
        <section className="task-list-panel">
          {tasks.map(renderTask)}
          {tasks.length === 0 && <p className="empty-msg">Nenhuma tarefa encontrada.</p>}
        </section>
      ) : (
        <section className="calendar-panel">
          {calendarTasks.map(renderTask)}
          {calendarTasks.length === 0 && <p className="empty-msg">Nenhuma tarefa com prazo para exibir no calendário.</p>}
        </section>
      )}
    </div>
  );
}
