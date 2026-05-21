import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../services/api';
import './styles.scss';

const ENTRY_TYPES = [
  { value: 'revenue', label: 'Receita/NF' },
  { value: 'payment_received', label: 'Pagamento recebido' },
  { value: 'scope_increase', label: 'Aumento de escopo' },
  { value: 'operational_expense', label: 'Custo operacional' },
  { value: 'transfer', label: 'Repasse' },
  { value: 'reimbursement', label: 'Reembolso' },
  { value: 'adjustment_positive', label: 'Ajuste positivo' },
  { value: 'adjustment_negative', label: 'Ajuste negativo' }
];

const ENTRY_STATUSES = [
  { value: 'pending', label: 'Pendente' },
  { value: 'expected', label: 'Previsto' },
  { value: 'paid', label: 'Pago' },
  { value: 'reimbursed', label: 'Reembolsado' },
  { value: 'canceled', label: 'Cancelado' },
  { value: 'archived', label: 'Arquivado' }
];

const DOCUMENT_TYPES = [
  ['contract', 'Contrato'],
  ['briefing', 'Briefing'],
  ['invoice', 'Nota fiscal'],
  ['receipt', 'Comprovante'],
  ['artwork', 'Arte'],
  ['folder', 'Pasta do Drive'],
  ['other', 'Outro']
];

const ENTRY_TAB_CONFIG = [
  ['all', 'Todos'],
  ['income', 'Receitas'],
  ['expense', 'Despesas'],
  ['reimbursement', 'Reembolsos'],
  ['archived', 'Arquivados']
];

const incomeTypes = ['revenue', 'income', 'scope_increase', 'scope_adjustment', 'payment_received', 'received_payment', 'adjustment_positive'];
const expenseTypes = ['operational_expense', 'expense', 'operational_cost', 'transfer', 'adjustment_negative'];
const reimbursementTypes = ['reimbursement'];

const PROJECT_STATUS_META = {
  pendente: { label: 'Pendente', className: 'pending' },
  aprovado: { label: 'Aprovado', className: 'approved' },
  'em andamento': { label: 'Em andamento', className: 'in-progress' },
  concluído: { label: 'Concluído', className: 'done' },
  garantia: { label: 'Garantia', className: 'warranty' }
};

function getProjectStatusMeta(status) {
  const normalized = String(status || 'pendente').toLowerCase().trim();
  const normalizedKey = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalizedKey.startsWith('conclu')) return PROJECT_STATUS_META.concluído;
  return PROJECT_STATUS_META[normalized] || {
    label: status || 'Pendente',
    className: normalized.replace(/\s+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  };
}

const PROVIDER_LABELS = {
  drive: 'Drive',
  external: 'Externo',
  other: 'Outro'
};

function getEntryStatusLabel(status) {
  return ENTRY_STATUSES.find(item => item.value === status)?.label || status || 'Pendente';
}

function getDocumentTypeLabel(type) {
  return DOCUMENT_TYPES.find(([value]) => value === type)?.[1] || 'Outro';
}

function getProviderLabel(provider) {
  return PROVIDER_LABELS[provider] || 'Outro';
}

function emptyEntryForm() {
  return {
    type: 'revenue',
    description: '',
    category: '',
    amount: '',
    gross_amount: '',
    own_amount: '',
    transfer_amount: '',
    date: new Date().toISOString().split('T')[0],
    payment_due_date: '',
    paid_at: '',
    status: 'pending',
    payment_method: '',
    affects_project_total: true,
    affects_my_financial: false,
    affects_personal_finance: false,
    reimbursable: false,
    billable_to_client: false,
    notes: '',
    document_file_name: '',
    document_file_url: '',
    document_type: 'receipt'
  };
}

export default function ProjectDetails() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [clients, setClients] = useState([]);
  const [teams, setTeams] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [finance, setFinance] = useState(null);
  const [projectFinanceSummary, setProjectFinanceSummary] = useState(null);
  const [projectEntries, setProjectEntries] = useState([]);
  const [entryTab, setEntryTab] = useState('all');
  const [canEditProjectEntries, setCanEditProjectEntries] = useState(false);
  const [entryForm, setEntryForm] = useState(emptyEntryForm());
  const [editingEntry, setEditingEntry] = useState(null);
  const [totalValueDraft, setTotalValueDraft] = useState('');
  const [shareDrafts, setShareDrafts] = useState({});
  const [statuses, setStatuses] = useState([]);
  const [members, setMembers] = useState([]);
  const [notes, setNotes] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [isProjectEditOpen, setIsProjectEditOpen] = useState(false);
  const [projectForm, setProjectForm] = useState({
    title: '',
    description: '',
    client_id: '',
    deadline: '',
    status: 'pendente',
    base_value: '',
    warranty_start_date: '',
    warranty_days: '',
    scope: 'individual',
    team_id: ''
  });
  const [documentForm, setDocumentForm] = useState({
    file_name: '',
    file_url: '',
    provider: 'drive',
    document_type: 'folder',
    description: ''
  });
  const [inviteEmail, setInviteEmail] = useState('');
  const [newOwnerId, setNewOwnerId] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [newNote, setNewNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const loadProjectData = useCallback(async () => {
    try {
      setErrorMessage('');
      const projRes = await api.get(`/projects/${id}`);
      setProject(projRes.data);

      const safeGet = async (url, fallback) => {
        try {
          return await api.get(url);
        } catch (err) {
          console.error(`Erro ao carregar dado auxiliar do projeto: ${url}`, err.response?.data || err);
          return { data: fallback };
        }
      };

      const [tasksRes, transRes, financeRes, statusesRes, membersRes, notesRes, entriesRes, summaryRes, docsRes, clientsRes, teamsRes] = await Promise.all([
        safeGet(`/tasks?project_id=${id}`, []),
        safeGet(`/transactions?project_id=${id}`, []),
        safeGet(`/projects/${id}/finance`, null),
        safeGet(`/projects/${id}/statuses`, []),
        safeGet(`/projects/${id}/members`, []),
        safeGet(`/projects/${id}/notes`, []),
        safeGet(`/projects/${id}/financial-entries`, { entries: [], can_edit_global: false }),
        safeGet(`/projects/${id}/finance-summary`, null),
        safeGet(`/projects/${id}/documents?status=active`, []),
        safeGet('/clients?status=all', []),
        safeGet('/teams?status=active', [])
      ]);

      setTasks(tasksRes.data);
      setTransactions(transRes.data);
      setFinance(financeRes.data);
      setTotalValueDraft(String(financeRes.data?.total_value || projRes.data?.base_value || ''));
      setShareDrafts(
        (financeRes.data?.shares || []).reduce((acc, share) => {
          acc[share.user_id] = String(share.amount || '');
          return acc;
        }, {})
      );
      setStatuses(statusesRes.data);
      setMembers(membersRes.data);
      setNotes(notesRes.data);
      setProjectEntries(entriesRes.data.entries || []);
      setCanEditProjectEntries(Boolean(entriesRes.data.can_edit_global));
      setProjectFinanceSummary(summaryRes.data);
      setDocuments(docsRes.data || []);
      setClients(clientsRes.data || []);
      setTeams(teamsRes.data || []);
    } catch (err) {
      console.error('Erro ao carregar detalhes do projeto', err.response?.data || err);
      setProject(null);
      if (err.response?.status === 403) {
        setErrorMessage(err.response?.data?.error || 'Sem permissão para acessar este projeto.');
      } else if (err.response?.status === 404) {
        setErrorMessage(err.response?.data?.error || 'Projeto não encontrado.');
      } else {
        setErrorMessage(err.response?.data?.error || 'Erro ao carregar detalhes do projeto.');
      }
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
      setFeedback('Anotação registrada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao registrar anotação.');
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
      setFeedback('Divisão financeira atualizada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar divisão financeira.');
    }
  }

  function openProjectEdit() {
    setProjectForm({
      title: project.title || '',
      description: project.description || '',
      client_id: project.client_id || '',
      deadline: project.deadline || '',
      status: project.status || 'pendente',
      base_value: project.base_value ?? '',
      warranty_start_date: project.warranty_start_date || '',
      warranty_days: project.warranty_days ?? '',
      scope: project.scope || 'individual',
      team_id: project.team_id || ''
    });
    setIsProjectEditOpen(true);
  }

  async function handleSaveProject(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.put(`/projects/${id}`, {
        ...projectForm,
        team_id: projectForm.scope === 'team' ? projectForm.team_id : null,
        base_value: projectForm.base_value === '' ? 0 : Number(projectForm.base_value),
        warranty_days: projectForm.warranty_days === '' ? 0 : Number(projectForm.warranty_days)
      });
      setIsProjectEditOpen(false);
      await loadProjectData();
      setFeedback('Projeto atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar projeto.');
    }
  }

  async function handleTransferOwner(e) {
    e.preventDefault();
    setFeedback('');

    if (!newOwnerId) {
      setFeedback('Selecione o novo dono do projeto.');
      return;
    }

    const selectedMember = members.find(member => String(member.id) === String(newOwnerId));
    const confirmed = window.confirm(`Deseja repassar este projeto para ${selectedMember?.name || 'este usuário'}?`);
    if (!confirmed) return;

    try {
      await api.patch(`/projects/${id}/owner`, { new_owner_id: Number(newOwnerId) });
      setNewOwnerId('');
      await loadProjectData();
      setFeedback('Dono do projeto atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao repassar projeto.');
    }
  }

  function resetEntryForm() {
    setEntryForm(emptyEntryForm());
    setEditingEntry(null);
  }

  function entryPayload() {
    return {
      ...entryForm,
      financial_type: entryForm.type,
      amount: Number(entryForm.gross_amount || entryForm.amount || 0),
      gross_amount: Number(entryForm.gross_amount || entryForm.amount || 0),
      own_amount: entryForm.own_amount === '' ? null : Number(entryForm.own_amount),
      transfer_amount: entryForm.transfer_amount === '' ? null : Number(entryForm.transfer_amount),
      payment_due_date: entryForm.payment_due_date || null,
      paid_at: entryForm.paid_at || null
    };
  }

  function handleEditEntry(entry) {
    setEditingEntry(entry);
    setEntryForm({
      ...emptyEntryForm(),
      type: entry.financial_type || entry.type || 'revenue',
      description: entry.description || '',
      category: entry.category || '',
      amount: String(entry.amount || ''),
      gross_amount: String(entry.gross_amount ?? entry.amount ?? ''),
      own_amount: entry.own_amount === null || entry.own_amount === undefined ? '' : String(entry.own_amount),
      transfer_amount: entry.transfer_amount === null || entry.transfer_amount === undefined ? '' : String(entry.transfer_amount),
      date: entry.date || new Date().toISOString().split('T')[0],
      payment_due_date: entry.payment_due_date || '',
      paid_at: entry.paid_at || '',
      status: entry.status || 'pending',
      payment_method: entry.payment_method || '',
      affects_project_total: Boolean(entry.affects_project_total),
      affects_my_financial: Boolean(entry.affects_my_financial),
      affects_personal_finance: Boolean(entry.affects_personal_finance),
      reimbursable: Boolean(entry.reimbursable),
      billable_to_client: Boolean(entry.billable_to_client),
      notes: entry.notes || '',
      document_file_name: '',
      document_file_url: '',
      document_type: 'receipt'
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSaveEntry(e) {
    e.preventDefault();
    setFeedback('');

    try {
      const payload = entryPayload();
      const entryResponse = editingEntry
        ? await api.put(`/projects/${id}/financial-entries/${editingEntry.id}`, payload)
        : await api.post(`/projects/${id}/financial-entries`, payload);
      if (entryForm.document_file_name && entryForm.document_file_url) {
        await api.post('/documents', {
          file_name: entryForm.document_file_name,
          file_url: entryForm.document_file_url,
          provider: 'drive',
          document_type: entryForm.document_type || 'receipt',
          project_id: id,
          project_financial_entry_id: editingEntry?.id || entryResponse.data.id,
          description: `Documento do lançamento: ${entryForm.description}`
        });
      }
      resetEntryForm();
      await loadProjectData();
      setFeedback(editingEntry ? 'Lançamento atualizado.' : 'Lançamento do projeto criado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar lançamento do projeto.');
    }
  }

  async function handleEntryStatus(entry, status) {
    try {
      await api.patch(`/projects/${id}/financial-entries/${entry.id}/status`, { status });
      await loadProjectData();
      setFeedback('Status do lançamento atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar status.');
    }
  }

  async function handleArchiveEntry(entry) {
    try {
      await api.delete(`/projects/${id}/financial-entries/${entry.id}`);
      await loadProjectData();
      setFeedback('Lançamento arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar lançamento.');
    }
  }

  async function handleRestoreEntry(entry) {
    try {
      await api.patch(`/projects/${id}/financial-entries/${entry.id}/restore`);
      await loadProjectData();
      setFeedback('Lançamento restaurado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao restaurar lançamento.');
    }
  }

  async function handleCreateDocument(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/documents', {
        ...documentForm,
        project_id: id
      });
      setDocumentForm({
        file_name: '',
        file_url: '',
        provider: 'drive',
        document_type: 'folder',
        description: ''
      });
      await loadProjectData();
      setFeedback('Documento do projeto cadastrado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao cadastrar documento do projeto.');
    }
  }

  async function handleArchiveDocument(document) {
    const confirmed = window.confirm('Deseja arquivar este documento? Ele poderá ser restaurado depois.');
    if (!confirmed) return;

    try {
      await api.patch(`/documents/${document.id}/archive`);
      await loadProjectData();
      setFeedback('Documento arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar documento.');
    }
  }

  async function handleRestoreDocument(document) {
    try {
      await api.patch(`/documents/${document.id}/restore`);
      await loadProjectData();
      setFeedback('Documento restaurado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao restaurar documento.');
    }
  }

  async function handleToggleTask(task) {
    const done = String(task.status || '').toLowerCase().startsWith('conclu') || task.status === 'done';
    const nextStatus = done ? 'pending' : 'done';
    const previousTasks = tasks;

    setTasks(current => current.map(item => (
      item.id === task.id
        ? { ...item, status: done ? 'pendente' : 'concluído' }
        : item
    )));

    try {
      await api.patch(`/tasks/${task.id}/status`, { status: nextStatus });
      await loadProjectData();
      setFeedback(done ? 'Tarefa reaberta.' : 'Tarefa concluída.');
    } catch (err) {
      setTasks(previousTasks);
      setFeedback(err.response?.data?.error || 'Erro ao atualizar tarefa.');
    }
  }

  async function handleRemoveProjectMember(member) {
    const confirmed = window.confirm('Remover esta pessoa do projeto?');
    if (!confirmed) return;

    try {
      await api.delete(`/projects/${id}/members/${member.id}`);
      await loadProjectData();
      setFeedback('Membro removido do projeto.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao remover membro do projeto.');
    }
  }

  if (loading) return <div className="loading">Carregando detalhes...</div>;
  if (!project) return <div className="error">{errorMessage || 'Projeto não encontrado.'}</div>;

  const totalIncome = transactions
    .filter(t => t.type === 'Receita')
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const totalExpense = transactions
    .filter(t => t.type === 'Despesa')
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const formatCurrency = value =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  const canTransferOwner = project.access_role === 'owner';
  const canEditProject = ['owner', 'admin', 'gestor'].includes(project.access_role);
  const canManageProjectMembers = ['owner', 'admin', 'gestor'].includes(project.access_role);
  const canViewProjectFinancials = Boolean(project.can_view_financials);
  const canEditAnyFinanceShare = Boolean(finance?.can_edit_total || finance?.shares?.some(share => share.can_edit));
  const projectStatusMeta = getProjectStatusMeta(project.status);
  const transferCandidates = members.filter(member => member.role !== 'owner');
  const financeKpis = [
    ['Contrato', projectFinanceSummary?.contract_value ?? projectFinanceSummary?.base_contract_value ?? project.base_value],
    ['Receitas adicionais', projectFinanceSummary?.additional_income],
    ['Custos reembolsáveis cobrados', projectFinanceSummary?.billable_reimbursable_costs],
    ['Valor atualizado', projectFinanceSummary?.updated_value ?? projectFinanceSummary?.updated_total_value],
    ['Recebido do cliente', projectFinanceSummary?.received_client ?? projectFinanceSummary?.received ?? projectFinanceSummary?.total_received],
    ['Pendente do cliente', projectFinanceSummary?.pending_client ?? projectFinanceSummary?.pending ?? projectFinanceSummary?.total_pending],
    ['Despesas operacionais', projectFinanceSummary?.operational_expenses ?? projectFinanceSummary?.expenses ?? projectFinanceSummary?.total_expenses],
    ['Repasses', projectFinanceSummary?.transfers_total],
    ['Pendente de repasse', projectFinanceSummary?.pending_transfer],
    ['A reembolsar', projectFinanceSummary?.reimbursable_expenses],
    ['Saldo líquido previsto', projectFinanceSummary?.net_balance ?? projectFinanceSummary?.estimated_net_balance],
    ['Caixa atual', projectFinanceSummary?.cash_current ?? projectFinanceSummary?.current_cash],
    ['Minha parte', projectFinanceSummary?.own_amount ?? projectFinanceSummary?.my_share]
  ];
  const entryTabCounts = {
    all: projectEntries.length,
    income: projectEntries.filter(entry => incomeTypes.includes(entry.type)).length,
    expense: projectEntries.filter(entry => expenseTypes.includes(entry.type)).length,
    reimbursement: projectEntries.filter(entry => reimbursementTypes.includes(entry.type)).length,
    archived: projectEntries.filter(entry => entry.archived === 1).length
  };
  const visibleProjectEntries = projectEntries.filter(entry => {
    if (entryTab === 'all') return entry.archived !== 1;
    if (entryTab === 'archived') return entry.archived === 1;
    if (entryTab === 'income') return entry.archived !== 1 && incomeTypes.includes(entry.type);
    if (entryTab === 'expense') return entry.archived !== 1 && expenseTypes.includes(entry.type);
    if (entryTab === 'reimbursement') return entry.archived !== 1 && reimbursementTypes.includes(entry.type);
    return true;
  });

  return (
    <div className="project-details-container">
      <header className="details-header">
        <div>
          <h1>{project.title}</h1>
          <p>Cliente: <strong>{project.client_name}</strong></p>
          <p>
            Tipo: <strong>{project.scope === 'team' ? 'Projeto de equipe' : 'Projeto individual'}</strong>
            {project.team_name ? <> - Time: <strong>{project.team_name}</strong></> : null}
          </p>
        </div>
        <div className="header-actions">
          <div className={`project-badge ${projectStatusMeta.className}`}>{projectStatusMeta.label}</div>
          {canEditProject && (
            <button type="button" className="btn-edit-project" onClick={openProjectEdit}>
              Editar projeto
            </button>
          )}
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      {isProjectEditOpen && (
        <div className="project-edit-overlay">
          <form className="project-edit-drawer" onSubmit={handleSaveProject}>
            <header>
              <div>
                <h2>Editar projeto</h2>
                <p>Atualize dados operacionais, prazo, status e garantia.</p>
              </div>
              <button type="button" onClick={() => setIsProjectEditOpen(false)}>x</button>
            </header>

            <label>
              Nome do projeto
              <input value={projectForm.title} onChange={e => setProjectForm({ ...projectForm, title: e.target.value })} required />
            </label>
            <label>
              Descrição
              <textarea value={projectForm.description} onChange={e => setProjectForm({ ...projectForm, description: e.target.value })} rows="3" />
            </label>
            <label>
              Cliente
              <select value={projectForm.client_id} onChange={e => setProjectForm({ ...projectForm, client_id: e.target.value })} required>
                <option value="">Selecione</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>
                    {client.name}{client.team_name ? ` - Time: ${client.team_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="edit-grid">
              <label>
                Prazo
                <input type="date" value={projectForm.deadline || ''} onChange={e => setProjectForm({ ...projectForm, deadline: e.target.value })} />
              </label>
              <label>
                Status
                <select value={projectForm.status} onChange={e => setProjectForm({ ...projectForm, status: e.target.value })}>
                  {statuses.map(status => (
                    <option key={status.id} value={status.name}>{getProjectStatusMeta(status.name).label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="edit-grid">
              <label>
                Valor base
                <input type="number" step="0.01" value={projectForm.base_value ?? ''} onChange={e => setProjectForm({ ...projectForm, base_value: e.target.value })} disabled={!project.can_edit_financials} />
              </label>
              <label>
                Tipo
                <select value={projectForm.scope} onChange={e => setProjectForm({ ...projectForm, scope: e.target.value, team_id: e.target.value === 'individual' ? '' : projectForm.team_id })}>
                  <option value="individual">Individual</option>
                  <option value="team">De equipe</option>
                </select>
              </label>
            </div>
            {projectForm.scope === 'team' && (
              <label>
                Time vinculado
                <select value={projectForm.team_id || ''} onChange={e => setProjectForm({ ...projectForm, team_id: e.target.value })} required>
                  <option value="">Selecione o time</option>
                  {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
            )}
            <div className="edit-grid">
              <label>
                Inicio da garantia
                <input type="date" value={projectForm.warranty_start_date || ''} onChange={e => setProjectForm({ ...projectForm, warranty_start_date: e.target.value })} />
              </label>
              <label>
                Prazo garantia (dias)
                <input type="number" min="0" step="1" value={projectForm.warranty_days ?? ''} onChange={e => setProjectForm({ ...projectForm, warranty_days: e.target.value })} />
              </label>
            </div>

            <div className="drawer-actions">
              <button type="button" className="btn-cancel" onClick={() => setIsProjectEditOpen(false)}>Cancelar</button>
              <button type="submit">Salvar alterações</button>
            </div>
          </form>
        </div>
      )}

      <section className="project-summary">
        <div className="summary-item">
          <span>Valor do Contrato</span>
          <strong>{canViewProjectFinancials ? formatCurrency(finance?.total_value ?? project.base_value) : 'Restrito'}</strong>
        </div>
        <div className="summary-item">
          <span>Meu Recebido</span>
          <strong className="income">{formatCurrency(totalIncome)}</strong>
        </div>
        <div className="summary-item">
          <span>Prazo</span>
          <strong>{project.deadline ? new Date(project.deadline).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Flexível'}</strong>
        </div>
        <div className="summary-item">
          <span>Garantia</span>
          <strong>{project.warranty_end_date ? `Até ${new Date(project.warranty_end_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : 'Sem garantia'}</strong>
        </div>
      </section>

      {finance && (
        <section className="finance-split-section">
          <div className="split-header">
            <div>
              <h2>{finance.can_view_global ? 'Divisão financeira' : 'Minha parte financeira'}</h2>
              <p>
                {finance.can_view_global
                  ? `${formatCurrency(finance.allocation_total)} distribuído de ${formatCurrency(finance.total_value)}`
                  : 'Você visualiza apenas a sua própria participação financeira neste projeto.'}
              </p>
            </div>
            {finance.can_view_global ? (
              <span className={finance.unallocated_amount === 0 ? 'balanced' : 'pending'}>
                {finance.unallocated_amount === 0 ? 'Fechado' : `${formatCurrency(finance.unallocated_amount)} sem dividir`}
              </span>
            ) : (
              <span className="restricted">Visão restrita</span>
            )}
          </div>

          <form onSubmit={handleSaveFinance} className="split-form">
            {finance.can_view_global && (
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
            )}

            <div className="share-list">
              {finance.shares.map(share => (
                <div key={share.user_id} className="share-row">
                  <div>
                    <strong>{share.name}</strong>
                    <span>{share.role === 'owner' ? 'Dono' : 'Colaborador'}{share.percentage !== null ? ` - ${Number(share.percentage || 0).toFixed(1)}%` : ''}</span>
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

            {canEditAnyFinanceShare && <button type="submit">Salvar divisão</button>}
          </form>
        </section>
      )}

      <section className="project-financial-entries">
        <div className="split-header">
          <div>
            <h2>Receitas e Despesas do Projeto</h2>
            {!project.can_view_financials && <p>Você visualiza apenas sua própria parte financeira neste projeto.</p>}
          </div>
        </div>

        {canViewProjectFinancials && projectFinanceSummary && (
          <div className="entry-summary-grid">
            {financeKpis.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{formatCurrency(value)}</strong>
              </div>
            ))}
          </div>
        )}

        {!canViewProjectFinancials && (
          <p className="readonly-note">Lançamentos globais e KPIs financeiros ficam ocultos para o seu papel.</p>
        )}

        {canEditProjectEntries && (
          <form onSubmit={handleSaveEntry} className={`entry-form ${editingEntry ? 'editing' : ''}`}>
            {editingEntry && <div className="editing-banner">Editando lançamento #{editingEntry.id}</div>}
            <select value={entryForm.type} onChange={e => setEntryForm({ ...entryForm, type: e.target.value })}>
              {ENTRY_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <input value={entryForm.description} onChange={e => setEntryForm({ ...entryForm, description: e.target.value })} placeholder="Descrição" required />
            <input value={entryForm.category} onChange={e => setEntryForm({ ...entryForm, category: e.target.value })} placeholder="Categoria" required />
            <input type="number" step="0.01" value={entryForm.gross_amount || entryForm.amount} onChange={e => setEntryForm({ ...entryForm, gross_amount: e.target.value, amount: e.target.value })} placeholder="Valor bruto" required />
            <input type="number" step="0.01" value={entryForm.own_amount} onChange={e => setEntryForm({ ...entryForm, own_amount: e.target.value })} placeholder="Minha parte" />
            <input type="number" step="0.01" value={entryForm.transfer_amount} onChange={e => setEntryForm({ ...entryForm, transfer_amount: e.target.value })} placeholder="Repasse" />
            <input type="date" value={entryForm.date} onChange={e => setEntryForm({ ...entryForm, date: e.target.value })} required />
            <input type="date" value={entryForm.payment_due_date} onChange={e => setEntryForm({ ...entryForm, payment_due_date: e.target.value })} title="Data prevista de pagamento" />
            <input type="date" value={entryForm.paid_at} onChange={e => setEntryForm({ ...entryForm, paid_at: e.target.value })} title="Data real de pagamento" />
            <select value={entryForm.status} onChange={e => setEntryForm({ ...entryForm, status: e.target.value })}>
              {ENTRY_STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
            <input value={entryForm.payment_method} onChange={e => setEntryForm({ ...entryForm, payment_method: e.target.value })} placeholder="Forma de pagamento" />
            <label><input type="checkbox" checked={entryForm.affects_project_total} onChange={e => setEntryForm({ ...entryForm, affects_project_total: e.target.checked })} /> Soma no projeto</label>
            <label><input type="checkbox" checked={entryForm.reimbursable} onChange={e => setEntryForm({ ...entryForm, reimbursable: e.target.checked, billable_to_client: e.target.checked ? true : entryForm.billable_to_client, affects_project_total: e.target.checked ? true : entryForm.affects_project_total })} /> Reembolsável</label>
            <label><input type="checkbox" checked={entryForm.billable_to_client} onChange={e => setEntryForm({ ...entryForm, billable_to_client: e.target.checked })} /> Cobrar do cliente</label>
            <label><input type="checkbox" checked={entryForm.affects_my_financial} onChange={e => setEntryForm({ ...entryForm, affects_my_financial: e.target.checked })} /> Meu financeiro</label>
            <p className="entry-help">Custos reembolsáveis podem ser cobrados do cliente e somam ao valor atualizado quando "Soma no projeto" estiver marcado.</p>
            <textarea value={entryForm.notes} onChange={e => setEntryForm({ ...entryForm, notes: e.target.value })} placeholder="Observações" />
            <input value={entryForm.document_file_name} onChange={e => setEntryForm({ ...entryForm, document_file_name: e.target.value })} placeholder="Nome do comprovante" />
            <input value={entryForm.document_file_url} onChange={e => setEntryForm({ ...entryForm, document_file_url: e.target.value })} placeholder="Link do comprovante" />
            <select value={entryForm.document_type} onChange={e => setEntryForm({ ...entryForm, document_type: e.target.value })}>
              <option value="receipt">Comprovante</option>
              <option value="invoice">Nota fiscal</option>
              <option value="boleto">Boleto</option>
              <option value="other">Outro</option>
            </select>
            <button type="submit">{editingEntry ? 'Salvar alterações' : 'Adicionar lançamento'}</button>
            {editingEntry && <button type="button" className="btn-cancel" onClick={resetEntryForm}>Cancelar edição</button>}
          </form>
        )}

        {canViewProjectFinancials && (
        <div className="entry-tabs">
          {ENTRY_TAB_CONFIG.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={entryTab === value ? 'active' : ''}
              onClick={() => setEntryTab(value)}
            >
              {label} <span>{entryTabCounts[value] || 0}</span>
            </button>
          ))}
        </div>
        )}

        {canViewProjectFinancials && (
        <div className="entries-table">
          <div className="entries-header">
            <span>Tipo</span>
            <span>Categoria</span>
            <span>Descrição</span>
            <span>Status</span>
            <span>Responsável</span>
            <span>Valor</span>
            <span>Data</span>
            <span>Acoes</span>
          </div>
          {visibleProjectEntries.map(entry => (
            <article key={entry.id}>
              <span className={`type-pill ${entry.type}`}>{ENTRY_TYPES.find(type => type.value === entry.type)?.label || entry.type}</span>
              <span>{entry.category}</span>
              <strong>{entry.description}</strong>
              <span className={`status-pill ${entry.status}`}>{getEntryStatusLabel(entry.status)}</span>
              <span>{entry.created_by_name || 'Você'}</span>
              <strong>{formatCurrency(entry.gross_amount ?? entry.amount)}</strong>
              <span>{new Date(entry.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
              {canEditProjectEntries ? (
                <div className="entry-actions">
                  <select
                    value={entry.archived === 1 ? 'archived' : entry.status}
                    disabled={entry.archived === 1}
                    onChange={e => handleEntryStatus(entry, e.target.value)}
                  >
                    {ENTRY_STATUSES.filter(status => status.value !== 'archived').map(status => (
                      <option key={status.value} value={status.value}>{status.label}</option>
                    ))}
                  </select>
                  <select
                    value=""
                    onChange={e => {
                      const action = e.target.value;
                      e.target.value = '';
                      if (action === 'edit') handleEditEntry(entry);
                      if (action === 'pending') handleEntryStatus(entry, 'pending');
                      if (action === 'paid') handleEntryStatus(entry, 'paid');
                      if (action === 'reimbursed') handleEntryStatus(entry, 'reimbursed');
                      if (action === 'canceled') handleEntryStatus(entry, 'canceled');
                      if (action === 'archive') handleArchiveEntry(entry);
                      if (action === 'restore') handleRestoreEntry(entry);
                    }}
                  >
                    <option value="">...</option>
                    {entry.archived !== 1 && <option value="edit">Editar</option>}
                    {entry.archived !== 1 && <option value="pending">Pendente</option>}
                    {entry.archived !== 1 && <option value="paid">Pago</option>}
                    {entry.archived !== 1 && <option value="reimbursed">Reembolsado</option>}
                    {entry.archived !== 1 && <option value="canceled">Cancelado</option>}
                    {entry.archived !== 1 && <option value="archive">Arquivar</option>}
                    {entry.archived === 1 && <option value="restore">Restaurar</option>}
                  </select>
                </div>
              ) : <span>-</span>}
            </article>
          ))}
          {visibleProjectEntries.length === 0 && <p className="empty">Nenhum lançamento nesta visualização.</p>}
        </div>
        )}
      </section>

      <section className="project-documents-section">
        <div className="split-header">
          <div>
            <h2>Documentos do Projeto</h2>
            <p>Contratos, briefings, comprovantes, NFs e pastas externas vinculadas a este projeto.</p>
          </div>
        </div>

        {canEditProject && (
          <form onSubmit={handleCreateDocument} className="document-inline-form">
            <input
              value={documentForm.file_name}
              onChange={e => setDocumentForm({ ...documentForm, file_name: e.target.value })}
              placeholder="Nome do documento"
              required
            />
            <input
              value={documentForm.file_url}
              onChange={e => setDocumentForm({ ...documentForm, file_url: e.target.value })}
              placeholder="https://..."
              required
            />
            <select value={documentForm.provider} onChange={e => setDocumentForm({ ...documentForm, provider: e.target.value })}>
              <option value="drive">Drive</option>
              <option value="external">Externo</option>
              <option value="other">Outro</option>
            </select>
            <select value={documentForm.document_type} onChange={e => setDocumentForm({ ...documentForm, document_type: e.target.value })}>
              {DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input
              value={documentForm.description}
              onChange={e => setDocumentForm({ ...documentForm, description: e.target.value })}
              placeholder="Descrição opcional"
            />
            <button type="submit">Adicionar documento</button>
          </form>
        )}

        <div className="documents-mini-list">
          {documents.map(document => (
            <article key={document.id} className={document.archived === 1 ? 'archived' : ''}>
              <div>
                <strong>{document.file_name}</strong>
                <span>{getDocumentTypeLabel(document.document_type)} - {getProviderLabel(document.provider)}{document.archived === 1 ? ' - Arquivado' : ''}</span>
              </div>
              <div>
                <a href={document.file_url} target="_blank" rel="noreferrer">Abrir</a>
                {document.can_edit && document.archived !== 1 && <button onClick={() => handleArchiveDocument(document)}>Arquivar</button>}
                {document.can_edit && document.archived === 1 && <button onClick={() => handleRestoreDocument(document)}>Restaurar</button>}
              </div>
            </article>
          ))}
          {documents.length === 0 && <p className="empty">Nenhum documento vinculado.</p>}
        </div>
      </section>

      <section className="collaboration-panel">
        <div className="panel-section">
          <h2>Status do projeto</h2>
          {canEditProject ? (
            <>
              <div className="status-options">
                {statuses.map(status => (
                  (() => {
                    const meta = getProjectStatusMeta(status.name);
                    return (
                  <button
                    key={status.id}
                    type="button"
                    className={`${project.status === status.name ? 'active' : ''} ${meta.className}`}
                    onClick={() => handleStatusChange(status.name)}
                  >
                    {meta.label}
                  </button>
                    );
                  })()
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
            </>
          ) : (
            <p className="readonly-note">Você pode acompanhar o status, mas não pode alterar o fluxo deste projeto.</p>
          )}
        </div>

        <div className="panel-section">
          <h2>Compartilhamento</h2>
          {canManageProjectMembers ? (
            <form onSubmit={handleInvite} className="inline-form">
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="email@exemplo.com"
              />
              <button type="submit">Convidar</button>
            </form>
          ) : (
            <p className="readonly-note">Você pode ver os participantes do projeto, mas não pode gerenciar acessos.</p>
          )}

          {canTransferOwner && transferCandidates.length > 0 && (
            <form onSubmit={handleTransferOwner} className="inline-form transfer-owner-form">
              <select value={newOwnerId} onChange={e => setNewOwnerId(e.target.value)}>
                <option value="">Novo dono</option>
                {transferCandidates.map(member => (
                  <option key={member.id} value={member.id}>
                    {member.name} - {member.email}
                  </option>
                ))}
              </select>
              <button type="submit">Repassar projeto</button>
            </form>
          )}

          <div className="members-list">
            {members.map(member => (
              <div key={`${member.role}-${member.id}`} className="member-item">
                <div>
                  <strong>{member.name}</strong>
                  {canManageProjectMembers && <span>{member.email}</span>}
                </div>
                <div className="member-actions">
                  <span className={`role-badge ${member.role}`}>{member.role === 'owner' ? 'Dono' : 'Colaborador'}</span>
                  {canManageProjectMembers && member.role !== 'owner' && (
                    <button type="button" onClick={() => handleRemoveProjectMember(member)}>Remover</button>
                  )}
                </div>
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
              <div
                key={task.id}
                className={`task-item ${String(task.status || '').toLowerCase().startsWith('conclu') || task.status === 'done' ? 'done' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={String(task.status || '').toLowerCase().startsWith('conclu') || task.status === 'done'}
                  onChange={() => handleToggleTask(task)}
                />
                <div>
                  <span className={String(task.status || '').toLowerCase().startsWith('conclu') || task.status === 'done' ? 'done' : ''}>{task.title}</span>
                  <small>
                    {task.assigned_name || 'Sem responsável'}
                    {task.due_date ? ` - ${new Date(task.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : ''}
                    {(String(task.status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').startsWith('conclu') || task.status === 'done') ? ' - Concluída' : ''}
                  </small>
                </div>
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
            {transactions.length === 0 && <p className="empty">Sem lançamentos individuais.</p>}
          </div>
        </section>
      </div>

      <section className="notes-section">
        <h2>Anotacoes de andamento</h2>
        <form onSubmit={handleAddNote} className="note-form">
          <textarea
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            placeholder="Registre uma decisão, pendência ou atualização importante..."
            rows="4"
          />
          <button type="submit">Registrar anotação</button>
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
          {notes.length === 0 && <p className="empty">Nenhuma anotação ainda.</p>}
        </div>
      </section>
    </div>
  );
}
