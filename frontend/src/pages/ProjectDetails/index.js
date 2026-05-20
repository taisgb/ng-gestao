import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../services/api';
import './styles.scss';

const ENTRY_TYPES = [
  { value: 'income', label: 'Receita' },
  { value: 'scope_increase', label: 'Aumento de escopo' },
  { value: 'expense', label: 'Despesa' },
  { value: 'operational_cost', label: 'Custo operacional' },
  { value: 'transfer', label: 'Repasse' },
  { value: 'reimbursement', label: 'Reembolso' },
  { value: 'received_payment', label: 'Pagamento recebido' },
  { value: 'scope_adjustment', label: 'Ajuste de escopo' }
];

const ENTRY_STATUSES = [
  { value: 'pending', label: 'Pendente' },
  { value: 'paid', label: 'Pago/recebido' },
  { value: 'reimbursed', label: 'Reembolsado' },
  { value: 'canceled', label: 'Cancelado' }
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

const incomeTypes = ['income', 'scope_increase', 'scope_adjustment', 'received_payment'];
const expenseTypes = ['expense', 'operational_cost', 'transfer'];
const reimbursementTypes = ['reimbursement'];

export default function ProjectDetails() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [finance, setFinance] = useState(null);
  const [projectFinanceSummary, setProjectFinanceSummary] = useState(null);
  const [projectEntries, setProjectEntries] = useState([]);
  const [entryTab, setEntryTab] = useState('all');
  const [canEditProjectEntries, setCanEditProjectEntries] = useState(false);
  const [entryForm, setEntryForm] = useState({
    type: 'income',
    description: '',
    category: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    status: 'pending',
    payment_method: '',
    affects_project_total: false,
    affects_my_financial: false,
    reimbursable: false,
    notes: '',
    document_file_name: '',
    document_file_url: '',
    document_type: 'receipt'
  });
  const [totalValueDraft, setTotalValueDraft] = useState('');
  const [shareDrafts, setShareDrafts] = useState({});
  const [statuses, setStatuses] = useState([]);
  const [members, setMembers] = useState([]);
  const [notes, setNotes] = useState([]);
  const [documents, setDocuments] = useState([]);
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

      const [tasksRes, transRes, financeRes, statusesRes, membersRes, notesRes, entriesRes, summaryRes, docsRes] = await Promise.all([
        safeGet(`/tasks?project_id=${id}`, []),
        safeGet(`/transactions?project_id=${id}`, []),
        safeGet(`/projects/${id}/finance`, null),
        safeGet(`/projects/${id}/statuses`, []),
        safeGet(`/projects/${id}/members`, []),
        safeGet(`/projects/${id}/notes`, []),
        safeGet(`/projects/${id}/financial-entries`, { entries: [], can_edit_global: false }),
        safeGet(`/projects/${id}/finance-summary`, null),
        safeGet(`/projects/${id}/documents?status=all`, [])
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
    } catch (err) {
      console.error('Erro ao carregar detalhes do projeto', err.response?.data || err);
      setProject(null);
      if (err.response?.status === 403) {
        setErrorMessage(err.response?.data?.error || 'Sem permissao para acessar este projeto.');
      } else if (err.response?.status === 404) {
        setErrorMessage(err.response?.data?.error || 'Projeto nao encontrado.');
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

  async function handleTransferOwner(e) {
    e.preventDefault();
    setFeedback('');

    if (!newOwnerId) {
      setFeedback('Selecione o novo dono do projeto.');
      return;
    }

    const selectedMember = members.find(member => String(member.id) === String(newOwnerId));
    const confirmed = window.confirm(`Deseja repassar este projeto para ${selectedMember?.name || 'este usuario'}?`);
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

  async function handleCreateEntry(e) {
    e.preventDefault();
    setFeedback('');

    try {
      const entryResponse = await api.post(`/projects/${id}/financial-entries`, {
        ...entryForm,
        amount: Number(entryForm.amount || 0)
      });
      if (entryForm.document_file_name && entryForm.document_file_url) {
        await api.post('/documents', {
          file_name: entryForm.document_file_name,
          file_url: entryForm.document_file_url,
          provider: 'drive',
          document_type: entryForm.document_type || 'receipt',
          project_id: id,
          project_financial_entry_id: entryResponse.data.id,
          description: `Documento do lancamento: ${entryForm.description}`
        });
      }
      setEntryForm({
        type: 'income',
        description: '',
        category: '',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        status: 'pending',
        payment_method: '',
        affects_project_total: false,
        affects_my_financial: false,
        reimbursable: false,
        notes: '',
        document_file_name: '',
        document_file_url: '',
        document_type: 'receipt'
      });
      await loadProjectData();
      setFeedback('Lancamento do projeto criado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao criar lancamento do projeto.');
    }
  }

  async function handleEntryStatus(entry, status) {
    try {
      await api.patch(`/projects/${id}/financial-entries/${entry.id}/status`, { status });
      await loadProjectData();
      setFeedback('Status do lancamento atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar status.');
    }
  }

  async function handleArchiveEntry(entry) {
    try {
      await api.delete(`/projects/${id}/financial-entries/${entry.id}`);
      await loadProjectData();
      setFeedback('Lancamento arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar lancamento.');
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
    const confirmed = window.confirm('Deseja arquivar este documento? Ele podera ser restaurado depois.');
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

  if (loading) return <div className="loading">Carregando detalhes...</div>;
  if (!project) return <div className="error">{errorMessage || 'Projeto nao encontrado.'}</div>;

  const totalIncome = transactions
    .filter(t => t.type === 'Receita')
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const totalExpense = transactions
    .filter(t => t.type === 'Despesa')
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const formatCurrency = value =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  const canTransferOwner = project.access_role === 'owner';
  const transferCandidates = members.filter(member => member.role !== 'owner');
  const financeKpis = [
    ['Contrato', projectFinanceSummary?.contract_value ?? projectFinanceSummary?.base_contract_value ?? project.base_value],
    ['Receitas adicionais', projectFinanceSummary?.additional_income],
    ['Valor atualizado', projectFinanceSummary?.updated_value ?? projectFinanceSummary?.updated_total_value],
    ['Recebido', projectFinanceSummary?.received ?? projectFinanceSummary?.total_received],
    ['Pendente', projectFinanceSummary?.pending ?? projectFinanceSummary?.total_pending],
    ['Despesas', projectFinanceSummary?.expenses ?? projectFinanceSummary?.total_expenses],
    ['A reembolsar', projectFinanceSummary?.reimbursable_expenses],
    ['Saldo liquido', projectFinanceSummary?.net_balance ?? projectFinanceSummary?.estimated_net_balance]
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

            <button type="submit">Salvar divisao</button>
          </form>
        </section>
      )}

      <section className="project-financial-entries">
        <div className="split-header">
          <div>
            <h2>Receitas e Despesas do Projeto</h2>
            {!project.can_view_financials && <p>Voce visualiza apenas sua propria parte financeira neste projeto.</p>}
          </div>
        </div>

        {projectFinanceSummary && (
          <div className="entry-summary-grid">
            {financeKpis.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{formatCurrency(value)}</strong>
              </div>
            ))}
          </div>
        )}

        {canEditProjectEntries && (
          <form onSubmit={handleCreateEntry} className="entry-form">
            <select value={entryForm.type} onChange={e => setEntryForm({ ...entryForm, type: e.target.value })}>
              {ENTRY_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <input value={entryForm.description} onChange={e => setEntryForm({ ...entryForm, description: e.target.value })} placeholder="Descricao" required />
            <input value={entryForm.category} onChange={e => setEntryForm({ ...entryForm, category: e.target.value })} placeholder="Categoria" required />
            <input type="number" step="0.01" value={entryForm.amount} onChange={e => setEntryForm({ ...entryForm, amount: e.target.value })} placeholder="Valor" required />
            <input type="date" value={entryForm.date} onChange={e => setEntryForm({ ...entryForm, date: e.target.value })} required />
            <select value={entryForm.status} onChange={e => setEntryForm({ ...entryForm, status: e.target.value })}>
              {ENTRY_STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
            <input value={entryForm.payment_method} onChange={e => setEntryForm({ ...entryForm, payment_method: e.target.value })} placeholder="Forma de pagamento" />
            <label><input type="checkbox" checked={entryForm.affects_project_total} onChange={e => setEntryForm({ ...entryForm, affects_project_total: e.target.checked })} /> Soma no projeto</label>
            <label><input type="checkbox" checked={entryForm.reimbursable} onChange={e => setEntryForm({ ...entryForm, reimbursable: e.target.checked })} /> Reembolsavel</label>
            <label><input type="checkbox" checked={entryForm.affects_my_financial} onChange={e => setEntryForm({ ...entryForm, affects_my_financial: e.target.checked })} /> Meu financeiro</label>
            <textarea value={entryForm.notes} onChange={e => setEntryForm({ ...entryForm, notes: e.target.value })} placeholder="Observacoes" />
            <input value={entryForm.document_file_name} onChange={e => setEntryForm({ ...entryForm, document_file_name: e.target.value })} placeholder="Nome do comprovante" />
            <input value={entryForm.document_file_url} onChange={e => setEntryForm({ ...entryForm, document_file_url: e.target.value })} placeholder="Link do comprovante" />
            <select value={entryForm.document_type} onChange={e => setEntryForm({ ...entryForm, document_type: e.target.value })}>
              <option value="receipt">Comprovante</option>
              <option value="invoice">Nota fiscal</option>
              <option value="boleto">Boleto</option>
              <option value="other">Outro</option>
            </select>
            <button type="submit">Adicionar lancamento</button>
          </form>
        )}

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

        <div className="entries-table">
          <div className="entries-header">
            <span>Tipo</span>
            <span>Categoria</span>
            <span>Descricao</span>
            <span>Status</span>
            <span>Responsavel</span>
            <span>Valor</span>
            <span>Data</span>
            <span>Acoes</span>
          </div>
          {visibleProjectEntries.map(entry => (
            <article key={entry.id}>
              <span className={`type-pill ${entry.type}`}>{ENTRY_TYPES.find(type => type.value === entry.type)?.label || entry.type}</span>
              <span>{entry.category}</span>
              <strong>{entry.description}</strong>
              <span className={`status-pill ${entry.status}`}>{entry.status}</span>
              <span>{entry.created_by_name || 'Voce'}</span>
              <strong>{formatCurrency(entry.amount)}</strong>
              <span>{new Date(entry.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
              {canEditProjectEntries ? (
                <div>
                  <button onClick={() => handleEntryStatus(entry, 'paid')}>Pago</button>
                  <button onClick={() => handleEntryStatus(entry, 'reimbursed')}>Reembolsar</button>
                  <button onClick={() => handleEntryStatus(entry, 'canceled')}>Cancelar</button>
                  <button onClick={() => handleArchiveEntry(entry)}>Arquivar</button>
                </div>
              ) : <span>-</span>}
            </article>
          ))}
          {visibleProjectEntries.length === 0 && <p className="empty">Nenhum lancamento nesta visualizacao.</p>}
        </div>
      </section>

      <section className="project-documents-section">
        <div className="split-header">
          <div>
            <h2>Documentos do Projeto</h2>
            <p>Contratos, briefings, comprovantes, NFs e pastas externas vinculadas a este projeto.</p>
          </div>
        </div>

        {canEditProjectEntries && (
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
              placeholder="Descricao opcional"
            />
            <button type="submit">Adicionar documento</button>
          </form>
        )}

        <div className="documents-mini-list">
          {documents.map(document => (
            <article key={document.id} className={document.archived === 1 ? 'archived' : ''}>
              <div>
                <strong>{document.file_name}</strong>
                <span>{document.document_type} - {document.provider}{document.archived === 1 ? ' - Arquivado' : ''}</span>
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
