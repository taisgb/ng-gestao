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
  status: 'pending',
  assigned_to: '',
  project_id: '',
  team_id: ''
};

const statusLabels = {
  pendente: 'Pendente',
  pending: 'Pendente',
  'em andamento': 'Em andamento',
  concluido: 'Concluida',
  'concluído': 'Concluida',
  done: 'Concluida'
};

function isTaskDone(status) {
  return doneStatuses.includes(status) || String(status || '').toLowerCase().startsWith('conclu');
}

function formatTaskDate(date) {
  if (!date) return 'Sem prazo';
  return new Date(date).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC'
  });
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
  const [assignees, setAssignees] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editAssignees, setEditAssignees] = useState([]);
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
      if (tab === 'calendar') params.set('view', 'calendar');

      const [tasksRes, projectsRes, teamsRes, summaryRes] = await Promise.all([
        api.get(`/tasks?${params.toString()}`),
        api.get('/projects?status=all'),
        api.get('/teams'),
        api.get('/tasks/summary')
      ]);

      setTasks(Array.isArray(tasksRes.data) ? tasksRes.data : []);
      setProjects(projectsRes.data);
      setTeams(teamsRes.data);
      setSummary(summaryRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar tarefas.');
    }
  }, [filters, tab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadAssignees = useCallback(async (projectId, teamId) => {
    try {
      if (projectId) {
        const response = await api.get(`/projects/${projectId}/members`);
        return (Array.isArray(response.data) ? response.data : []).map(member => ({
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role
        }));
      }

      if (teamId) {
        const response = await api.get(`/teams/${teamId}/members`);
        return (Array.isArray(response.data) ? response.data : [])
          .filter(member => member.user_id && member.status !== 'removed')
          .map(member => ({
            id: member.user_id,
            name: member.name || member.email,
            email: member.email,
            role: member.role
          }));
      }
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar responsaveis.');
    }

    return user?.id ? [{ id: user.id, name: user.name || 'Voce', email: user.email }] : [];
  }, [user]);

  useEffect(() => {
    let active = true;

    loadAssignees(form.project_id, form.team_id).then(options => {
      if (!active) return;

      setAssignees(options);
      if (form.assigned_to && !options.some(option => String(option.id) === String(form.assigned_to))) {
        setForm(current => ({ ...current, assigned_to: '' }));
      }
    });

    return () => {
      active = false;
    };
  }, [form.project_id, form.team_id, form.assigned_to, loadAssignees]);

  useEffect(() => {
    if (!editingTask) return undefined;

    let active = true;

    loadAssignees(editForm.project_id, editForm.team_id).then(options => {
      if (!active) return;

      setEditAssignees(options);
      if (editForm.assigned_to && !options.some(option => String(option.id) === String(editForm.assigned_to))) {
        setEditForm(current => ({ ...current, assigned_to: '' }));
      }
    });

    return () => {
      active = false;
    };
  }, [editingTask, editForm.project_id, editForm.team_id, editForm.assigned_to, loadAssignees]);

  const calendarTasks = useMemo(() => tasks.filter(task => task.due_date), [tasks]);
  const calendarEntries = useMemo(() => {
    const groups = calendarTasks.reduce((acc, task) => ({
      ...acc,
      [task.due_date]: [...(acc[task.due_date] || []), task]
    }), {});

    return Object.entries(groups).sort(([dateA], [dateB]) => dateA.localeCompare(dateB));
  }, [calendarTasks]);

  async function handleCreate(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/tasks', {
        ...form,
        project_id: form.project_id || null,
        team_id: form.project_id ? null : form.team_id || null,
        assigned_to: form.assigned_to || null,
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
      const normalizedPayload = { ...payload };
      if (normalizedPayload.status === 'pendente') normalizedPayload.status = 'pending';
      if (String(normalizedPayload.status || '').toLowerCase().startsWith('conclu')) normalizedPayload.status = 'done';

      if (Object.keys(normalizedPayload).length === 1 && normalizedPayload.status !== undefined) {
        await api.patch(`/tasks/${task.id}/status`, normalizedPayload);
      } else {
        await api.put(`/tasks/${task.id}`, normalizedPayload);
      }
      await loadData();
      setFeedback(message);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar tarefa.');
    }
  }

  function openEditTask(task) {
    setEditingTask(task);
    setEditForm({
      title: task.title || '',
      description: task.description || '',
      due_date: task.due_date || '',
      task_type: task.task_type || 'operational',
      priority: task.priority || 'medium',
      status: isTaskDone(task.status) ? 'done' : task.status || 'pending',
      assigned_to: task.assigned_to || '',
      project_id: task.project_id || '',
      team_id: task.project_id ? '' : task.team_id || ''
    });
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editingTask) return;

    try {
      await api.put(`/tasks/${editingTask.id}`, {
        ...editForm,
        project_id: editForm.project_id || null,
        team_id: editForm.project_id ? null : editForm.team_id || null,
        assigned_to: editForm.assigned_to || null,
        due_date: editForm.due_date || null
      });
      setEditingTask(null);
      setEditForm(emptyForm);
      await loadData();
      setFeedback('Tarefa atualizada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar tarefa.');
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
          <strong>{done ? 'Concluida' : statusLabels[task.status] || task.status}</strong>
        </div>

        <div className="task-actions">
          <button onClick={() => patchTask(task, { status: done ? 'pendente' : 'concluído' }, done ? 'Tarefa reaberta.' : 'Tarefa concluida.')}>
            {done ? 'Reabrir' : 'Concluir'}
          </button>
          <button onClick={() => openEditTask(task)}>Editar</button>
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
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="pending">Pendente</option>
            <option value="em andamento">Em andamento</option>
            <option value="done">Concluida</option>
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
          <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}>
            <option value="">Responsavel: eu</option>
            {assignees.map(assignee => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.name || assignee.email}
              </option>
            ))}
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
          {calendarEntries.length > 0 ? (
            <div className="calendar-grid">
              {calendarEntries.map(([date, dateTasks]) => (
                <article key={date} className="calendar-day-card">
                  <header>
                    <span>{formatTaskDate(date)}</span>
                    <strong>{dateTasks.length}</strong>
                  </header>
                  <div className="calendar-day-tasks">
                    {dateTasks.map(task => {
                      const done = isTaskDone(task.status);

                      return (
                        <div key={task.id} className={`calendar-task-card ${task.priority} ${done ? 'done' : ''}`}>
                          <strong>{task.title}</strong>
                          <span>{task.project_title || task.client_name || sourceLabels[task.task_type] || 'Tarefa'}</span>
                          <small>{done ? 'Concluida' : priorityLabels[task.priority] || task.priority}</small>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {calendarTasks.length === 0 && <p className="empty-msg">Nenhuma tarefa com prazo para exibir no calendário.</p>}
        </section>
      )}

      {editingTask && (
        <div className="task-modal-overlay" role="presentation" onClick={() => setEditingTask(null)}>
          <section className="task-edit-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <header>
              <div>
                <span>Editar tarefa</span>
                <h2>{editingTask.title}</h2>
              </div>
              <button type="button" onClick={() => setEditingTask(null)}>Fechar</button>
            </header>

            <form onSubmit={handleSaveEdit}>
              <label>
                Titulo
                <input value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} required />
              </label>

              <label>
                Descricao
                <textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows="4" />
              </label>

              <div className="modal-grid">
                <label>
                  Origem
                  <select value={editForm.task_type} onChange={e => setEditForm({ ...editForm, task_type: e.target.value })}>
                    <option value="operational">Operacional</option>
                    <option value="financial">Financeira</option>
                    <option value="document">Documento</option>
                    <option value="invoice">Nota fiscal</option>
                    <option value="service">Servico</option>
                    <option value="recurring">Recorrente</option>
                  </select>
                </label>

                <label>
                  Prioridade
                  <select value={editForm.priority} onChange={e => setEditForm({ ...editForm, priority: e.target.value })}>
                    <option value="low">Baixa</option>
                    <option value="medium">Media</option>
                    <option value="high">Alta</option>
                    <option value="urgent">Urgente</option>
                  </select>
                </label>

                <label>
                  Status
                  <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                    <option value="pending">Pendente</option>
                    <option value="em andamento">Em andamento</option>
                    <option value="done">Concluida</option>
                  </select>
                </label>

                <label>
                  Prazo
                  <input type="date" value={editForm.due_date} onChange={e => setEditForm({ ...editForm, due_date: e.target.value })} />
                </label>

                <label>
                  Projeto
                  <select value={editForm.project_id} onChange={e => setEditForm({ ...editForm, project_id: e.target.value, team_id: '', assigned_to: '' })}>
                    <option value="">Sem projeto</option>
                    {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
                  </select>
                </label>

                <label>
                  Time
                  <select value={editForm.team_id} disabled={Boolean(editForm.project_id)} onChange={e => setEditForm({ ...editForm, team_id: e.target.value, assigned_to: '' })}>
                    <option value="">Individual</option>
                    {teams.map(team => <option key={team.id} value={team.id}>Time: {team.name}</option>)}
                  </select>
                </label>

                <label>
                  Responsavel
                  <select value={editForm.assigned_to} onChange={e => setEditForm({ ...editForm, assigned_to: e.target.value })}>
                    <option value="">Sem responsavel</option>
                    {editAssignees.map(assignee => (
                      <option key={assignee.id} value={assignee.id}>
                        {assignee.name || assignee.email}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="modal-actions">
                <button type="button" onClick={() => setEditingTask(null)}>Cancelar</button>
                <button type="submit">Salvar alteracoes</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
