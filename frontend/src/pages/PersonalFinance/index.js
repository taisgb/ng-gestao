import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

const emptyTransaction = {
  description: '',
  type: 'income',
  category: 'Projeto',
  amount: '',
  gross_amount: '',
  own_amount: '',
  transfer_amount: '',
  date: new Date().toISOString().split('T')[0],
  payment_due_date: '',
  paid_at: '',
  status: 'expected',
  payment_method: '',
  source: 'manual',
  origin_label: '',
  visibility: 'private',
  shared_with_project_owner: false,
  financial_type: '',
  financial_scope: 'personal',
  project_id: '',
  recurrence_frequency: '',
  notes: '',
  is_recurring: false
};

const incomeCategories = ['Projeto', 'Serviço recorrente', 'Consultoria', 'Distribuição de projeto', 'Reembolso', 'Outros'];
const expenseCategories = ['Software', 'Assinaturas', 'Tráfego pago', 'Equipamentos', 'Banco/cartão', 'Impostos', 'Hospedagem', 'Plugin', 'Domínio', 'Outros'];
const personalExpenseCategories = ['Assinaturas', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Moradia', 'Lazer', 'Cartão de crédito', 'Academia', 'Impostos', 'Outros'];
const statusLabels = { expected: 'Previsto', paid: 'Pago', overdue: 'Atrasado', canceled: 'Cancelado' };
const financialTypeLabels = {
  revenue: 'Receita / NF',
  payment_received: 'Pagamento recebido',
  transfer: 'Repasse',
  operational_expense: 'Despesa operacional',
  reimbursement: 'Reembolso',
  personal_expense: 'Despesa pessoal'
};
const scopeLabels = {
  personal: 'Pessoal',
  work: 'Trabalho',
  project: 'Projeto'
};
const recurrenceLabels = {
  monthly: 'Mensal',
  weekly: 'Semanal',
  yearly: 'Anual'
};
const sourceLabels = {
  project: 'Projeto',
  project_distribution: 'Distribuição',
  reimbursement: 'Reembolso',
  renegotiation: 'Renegociação',
  recurring: 'Recorrente',
  manual: 'Outro / Manual'
};

const contextTabs = [
  { value: 'overview', label: 'Visão geral' },
  { value: 'work', label: 'Trabalho' },
  { value: 'personal', label: 'Pessoal' },
  { value: 'recurring', label: 'Recorrentes' }
];

const movementTabs = [
  { value: 'all', label: 'Todos' },
  { value: 'expected', label: 'Previstos' },
  { value: 'received', label: 'Recebidos' },
  { value: 'expenses', label: 'Despesas' },
  { value: 'transfers', label: 'Repasses' },
  { value: 'recurring', label: 'Recorrentes' },
  { value: 'archived', label: 'Arquivados' }
];

const entryKinds = [
  { value: 'revenue', label: 'Receita de trabalho / NF' },
  { value: 'payment_received', label: 'Pagamento recebido' },
  { value: 'personal_expense', label: 'Despesa pessoal' },
  { value: 'work_expense', label: 'Despesa do trabalho' },
  { value: 'transfer', label: 'Repasse' },
  { value: 'reimbursement', label: 'Reembolso' }
];

const emptySummary = {
  bank_balance: 0,
  gross_revenue_total: 0,
  expected_month: 0,
  received: 0,
  personal_expenses: 0,
  work_expenses: 0,
  transfers: 0,
  own_amount: 0,
  projected_balance: 0,
  personal_projected_balance: 0,
  recurring_expenses: 0,
  total_debt: 0,
  current_card_bill: 0,
  fixed_installments: 0
};

function parseCurrency(value) {
  if (typeof value === 'number') return value;
  const normalized = String(value || '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

function inferEntryKind(item) {
  if (item.financial_type === 'personal_expense') return 'personal_expense';
  if (item.financial_type === 'operational_expense') return 'work_expense';
  if (item.financial_type === 'transfer') return 'transfer';
  if (item.financial_type === 'reimbursement') return 'reimbursement';
  if (item.financial_type === 'payment_received') return 'payment_received';
  return item.type === 'expense' ? 'work_expense' : 'revenue';
}

function presetForEntryKind(kind) {
  const base = { ...emptyTransaction, date: todayIso() };
  const presets = {
    revenue: {
      type: 'income',
      category: 'Projeto',
      status: 'expected',
      source: 'project',
      financial_type: 'revenue',
      financial_scope: 'work'
    },
    payment_received: {
      type: 'income',
      category: 'Projeto',
      status: 'paid',
      source: 'project',
      financial_type: 'payment_received',
      financial_scope: 'project'
    },
    personal_expense: {
      type: 'expense',
      category: 'Assinaturas',
      status: 'expected',
      source: 'manual',
      financial_type: 'personal_expense',
      financial_scope: 'personal'
    },
    work_expense: {
      type: 'expense',
      category: 'Software',
      status: 'expected',
      source: 'manual',
      financial_type: 'operational_expense',
      financial_scope: 'work'
    },
    transfer: {
      type: 'expense',
      category: 'Repasse',
      status: 'expected',
      source: 'project_distribution',
      financial_type: 'transfer',
      financial_scope: 'project'
    },
    reimbursement: {
      type: 'income',
      category: 'Reembolso',
      status: 'expected',
      source: 'reimbursement',
      financial_type: 'reimbursement',
      financial_scope: 'project'
    }
  };

  return { ...base, ...(presets[kind] || {}) };
}

export default function PersonalFinance() {
  const [summary, setSummary] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [renegotiations, setRenegotiations] = useState([]);
  const [projects, setProjects] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(null);
  const [actionTransaction, setActionTransaction] = useState(null);
  const [contextTab, setContextTab] = useState('overview');
  const [movementTab, setMovementTab] = useState('all');
  const [periodMode, setPeriodMode] = useState('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showDetailedKpis, setShowDetailedKpis] = useState(false);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [entryKind, setEntryKind] = useState('');
  const [filters, setFilters] = useState({
    month: '',
    year: '',
    from: '',
    to: '',
    type: '',
    status: '',
    category: '',
    source: '',
    project_id: '',
    financial_scope: '',
    financial_type: '',
    is_recurring: ''
  });
  const [transactionForm, setTransactionForm] = useState(emptyTransaction);
  const [statusForm, setStatusForm] = useState({
    total_bank_balance: '',
    total_debt: '',
    credit_card_bill: ''
  });
  const [debtForm, setDebtForm] = useState({
    description: '',
    installment_value: '',
    total_installments: '',
    start_date: new Date().toISOString().split('T')[0]
  });

  const loadData = useCallback(async () => {
    try {
      const query = new URLSearchParams(
        Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
      ).toString();
      const summaryQuery = new URLSearchParams();
      if (filters.month && filters.year) {
        summaryQuery.set('month', filters.month);
        summaryQuery.set('year', filters.year);
      }
      const safeGet = async (url, fallback, label) => {
        try {
          const response = await api.get(url);
          return response.data;
        } catch (err) {
          console.error(`Erro ao carregar ${label}`, err.response?.data || err);
          setFeedback(current => current || `Erro ao carregar ${label}. Usando dados zerados temporariamente.`);
          return fallback;
        }
      };

      const [summaryData, dashboardData, transactionsData, renegotiationsData, projectsData] = await Promise.all([
        safeGet(`/personal/summary?${summaryQuery.toString()}`, emptySummary, 'resumo pessoal'),
        safeGet('/personal/dashboard', {}, 'indicadores pessoais'),
        safeGet(`/personal/transactions?${query}`, [], 'lançamentos pessoais'),
        safeGet('/personal/renegotiations', [], 'renegociacoes'),
        safeGet('/projects?status=all', [], 'projetos')
      ]);

      setSummary({ ...emptySummary, ...summaryData });
      setDashboard(dashboardData);
      setTransactions(Array.isArray(transactionsData) ? transactionsData : []);
      setRenegotiations(Array.isArray(renegotiationsData) ? renegotiationsData : []);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setStatusForm({
        total_bank_balance: String(dashboardData.bank_balance || ''),
        total_debt: String(dashboardData.total_debt || ''),
        credit_card_bill: String(dashboardData.current_card_bill || '')
      });
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar financeiro pessoal.');
    }
  }, [filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const categories = transactionForm.financial_type === 'personal_expense'
    ? personalExpenseCategories
    : transactionForm.financial_type === 'transfer'
      ? ['Repasse', 'Designer', 'Parceiro', 'Fornecedor', 'Outros']
      : transactionForm.financial_type === 'reimbursement'
        ? ['Reembolso', 'Comprovante', 'Ferramenta', 'Hospedagem', 'Outros']
        : transactionForm.type === 'income'
          ? incomeCategories
          : expenseCategories;
  const isManualOrigin = transactionForm.source === 'manual';
  const currentMonthExpenses = Number(summary?.personal_expenses || 0) + Number(summary?.work_expenses || 0);
  const mainKpis = useMemo(() => {
    if (contextTab === 'work') {
      return [
        { label: 'Faturamento bruto', value: summary?.gross_revenue_total, tone: 'income' },
        { label: 'Previsto no mês', value: summary?.expected_month, tone: 'income' },
        { label: 'Minha parte', value: summary?.own_amount, tone: 'fixed' },
        { label: 'Repasses', value: summary?.transfers, tone: 'debt' }
      ];
    }

    if (contextTab === 'personal') {
      return [
        { label: 'Despesas pessoais do mês', value: summary?.personal_expenses, tone: 'debt' },
        { label: 'Recorrentes', value: summary?.recurring_expenses, tone: 'debt' },
        { label: 'Fatura atual', value: summary?.current_card_bill ?? dashboard?.current_card_bill, tone: 'card-bill' },
        { label: 'Saldo pessoal previsto', value: summary?.personal_projected_balance, tone: 'fixed' }
      ];
    }

    if (contextTab === 'recurring') {
      return [
        { label: 'Recorrentes', value: summary?.recurring_expenses, tone: 'debt' },
        { label: 'Previsto no mês', value: summary?.expected_month, tone: 'income' },
        { label: 'Despesas pessoais', value: summary?.personal_expenses, tone: 'debt' },
        { label: 'Parcelas fixas', value: summary?.fixed_installments ?? dashboard?.fixed_debts_month, tone: 'fixed' }
      ];
    }

    return [
      { label: 'Saldo atual', value: summary?.bank_balance, tone: 'fixed' },
      { label: 'Previsto no mês', value: summary?.expected_month, tone: 'income' },
      { label: 'Minha parte', value: summary?.own_amount, tone: 'fixed' },
      { label: 'Despesas do mês', value: currentMonthExpenses, tone: 'debt' }
    ];
  }, [contextTab, currentMonthExpenses, dashboard, summary]);

  const detailedKpis = [
    { label: 'Faturamento total', value: summary?.gross_revenue_total, tone: 'income' },
    { label: 'Recebido', value: summary?.received, tone: 'income' },
    { label: 'Repasses', value: summary?.transfers, tone: 'debt' },
    { label: 'Saldo previsto', value: summary?.projected_balance, tone: 'fixed' },
    { label: 'Saldo pessoal previsto', value: summary?.personal_projected_balance, tone: 'fixed' },
    { label: 'Recorrentes', value: summary?.recurring_expenses, tone: 'debt' },
    { label: 'Dívida total', value: summary?.total_debt ?? dashboard?.total_debt, tone: 'debt' },
    { label: 'Fatura atual', value: summary?.current_card_bill ?? dashboard?.current_card_bill, tone: 'card-bill' },
    { label: 'Parcelas fixas', value: summary?.fixed_installments ?? dashboard?.fixed_debts_month, tone: 'fixed' }
  ];

  const scopedTransactions = useMemo(() => transactions.filter(item => {
    if (contextTab === 'work') return ['work', 'project'].includes(item.financial_scope) || item.source === 'project';
    if (contextTab === 'personal') return item.financial_scope === 'personal';
    if (contextTab === 'recurring') return Boolean(item.is_recurring);
    return true;
  }), [contextTab, transactions]);

  const visibleTransactions = useMemo(() => scopedTransactions.filter(item => {
    if (movementTab === 'expected') return ['expected', 'overdue'].includes(item.status);
    if (movementTab === 'received') return item.status === 'paid' && item.type === 'income';
    if (movementTab === 'expenses') return item.type === 'expense' && item.financial_type !== 'transfer';
    if (movementTab === 'transfers') return item.financial_type === 'transfer';
    if (movementTab === 'recurring') return Boolean(item.is_recurring);
    if (movementTab === 'archived') return Boolean(item.archived) || item.status === 'archived';
    return !item.archived && item.status !== 'archived';
  }), [movementTab, scopedTransactions]);

  function formatSource(item) {
    return item.origin_label || sourceLabels[item.source] || item.source || '-';
  }

  function formatFinancialType(item) {
    return financialTypeLabels[item.financial_type] || (item.type === 'expense' ? 'Despesa' : 'Receita');
  }

  function formatScope(item) {
    return scopeLabels[item.financial_scope] || 'Pessoal';
  }

  function getProjectName(item) {
    const projectId = item.project_id || item.projectId;
    if (!projectId) return '-';
    const project = projects.find(option => Number(option.id) === Number(projectId));
    return project?.name || project?.title || item.project_name || `Projeto #${projectId}`;
  }

  function getMovementDate(item) {
    return item.payment_due_date || item.paid_at || item.date;
  }

  function getMovementValue(item) {
    return item.own_amount || item.amount || item.gross_amount;
  }

  function openTransactionModal(kind = '') {
    setEditing(null);
    setActionTransaction(null);
    setEntryKind(kind);
    setTransactionForm(kind ? presetForEntryKind(kind) : emptyTransaction);
    setIsTransactionModalOpen(true);
  }

  function selectEntryKind(kind) {
    setEntryKind(kind);
    setTransactionForm(presetForEntryKind(kind));
  }

  function applyPeriod(mode) {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear());
    setPeriodMode(mode);

    if (mode === 'all') {
      setFilters(current => ({ ...current, month: '', year: '', from: '', to: '' }));
      return;
    }

    if (mode === 'current') {
      setFilters(current => ({ ...current, month, year, from: '', to: '' }));
      return;
    }

    if (mode === 'specific') {
      setFilters(current => ({ ...current, month: current.month || month, year: current.year || year, from: '', to: '' }));
      return;
    }

    if (mode === 'year') {
      setFilters(current => ({ ...current, month: '', year: current.year || year, from: '', to: '' }));
      return;
    }

    setFilters(current => ({ ...current, month: '', year: '', from: current.from, to: current.to }));
  }

  function resetTransactionForm() {
    setTransactionForm(emptyTransaction);
    setEditing(null);
    setEntryKind('');
    setIsTransactionModalOpen(false);
  }

  function startEdit(item) {
    setEditing(item);
    setActionTransaction(null);
    setEntryKind(inferEntryKind(item));
    setIsTransactionModalOpen(true);
    setTransactionForm({
      description: item.description || '',
      type: item.type || 'income',
      category: item.category || 'Outros',
      amount: String(item.amount || ''),
      gross_amount: String(item.gross_amount || ''),
      own_amount: String(item.own_amount || ''),
      transfer_amount: String(item.transfer_amount || ''),
      date: item.date || new Date().toISOString().split('T')[0],
      payment_due_date: item.payment_due_date || '',
      paid_at: item.paid_at || '',
      status: item.status || 'expected',
      payment_method: item.payment_method || '',
      source: item.source || 'manual',
      origin_label: item.origin_label || '',
      visibility: item.visibility || 'private',
      shared_with_project_owner: Boolean(item.shared_with_project_owner),
      financial_type: item.financial_type || '',
      financial_scope: item.financial_scope || 'personal',
      project_id: item.project_id || '',
      recurrence_frequency: item.recurrence_frequency || '',
      notes: item.notes || '',
      is_recurring: Boolean(item.is_recurring)
    });
  }

  function handleActionEdit(item) {
    startEdit(item);
  }

  async function handleActionStatus(status) {
    if (!actionTransaction) return;
    const item = actionTransaction;
    setActionTransaction(null);
    await handleStatus(item, status);
  }

  async function handleActionArchive() {
    if (!actionTransaction) return;
    const item = actionTransaction;
    setActionTransaction(null);
    await handleArchive(item);
  }

  async function handleSaveTransaction(e) {
    e.preventDefault();
    setFeedback('');

    const payload = {
      ...transactionForm,
      amount: parseCurrency(transactionForm.amount),
      gross_amount: transactionForm.gross_amount ? parseCurrency(transactionForm.gross_amount) : null,
      own_amount: transactionForm.own_amount ? parseCurrency(transactionForm.own_amount) : null,
      transfer_amount: transactionForm.transfer_amount ? parseCurrency(transactionForm.transfer_amount) : null,
      payment_due_date: transactionForm.payment_due_date || null,
      paid_at: transactionForm.paid_at || null,
      financial_type: transactionForm.financial_type || null,
      financial_scope: transactionForm.financial_scope || 'personal',
      recurrence_frequency: transactionForm.is_recurring ? transactionForm.recurrence_frequency || 'monthly' : null,
      origin_label: (transactionForm.source === 'manual' || transactionForm.financial_type === 'transfer') ? transactionForm.origin_label.trim() : '',
      is_recurring: transactionForm.is_recurring ? 1 : 0
    };

    try {
      if (editing) {
        await api.put(`/personal/transactions/${editing.id}`, payload);
        setFeedback('Lançamento atualizado.');
      } else {
        await api.post('/personal/transactions', payload);
        setFeedback('Lançamento criado.');
      }
      resetTransactionForm();
      await loadData();
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar lançamento.');
    }
  }

  async function handleStatus(item, status) {
    try {
      await api.patch(`/personal/transactions/${item.id}/status`, { status });
      await loadData();
      setFeedback('Status atualizado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao atualizar status.');
    }
  }

  async function handleArchive(item) {
    const confirmed = window.confirm('Deseja arquivar este lançamento?');
    if (!confirmed) return;

    try {
      await api.delete(`/personal/transactions/${item.id}`);
      await loadData();
      setFeedback('Lançamento arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar lançamento.');
    }
  }

  async function handleSaveStatus(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.put('/personal/status', {
        total_bank_balance: parseCurrency(statusForm.total_bank_balance),
        total_debt: parseCurrency(statusForm.total_debt),
        credit_card_bill: parseCurrency(statusForm.credit_card_bill)
      });
      await loadData();
      setFeedback('Indicadores pessoais atualizados.');
      setIsStatusModalOpen(false);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar indicadores.');
    }
  }

  async function handleCreateDebt(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/personal/renegotiations', {
        ...debtForm,
        installment_value: parseCurrency(debtForm.installment_value),
        total_installments: Number(debtForm.total_installments || 0)
      });
      setDebtForm({
        description: '',
        installment_value: '',
        total_installments: '',
        start_date: new Date().toISOString().split('T')[0]
      });
      await loadData();
      setFeedback('Renegociação adicionada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao cadastrar renegociação.');
    }
  }

  const formatCurrency = value =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  const formatDate = value => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '-';

  function renderRows(rows) {
    return (
      <div className="transaction-table">
        <div className="table-head">
          <span>Descrição</span>
          <span>Escopo/origem</span>
          <span>Projeto</span>
          <span>Data prevista</span>
          <span>Valor</span>
          <span>Status</span>
          <span>Ações</span>
        </div>
        {rows.map(item => (
          <article key={item.id}>
            <div className="description-cell">
              <strong>{item.description}</strong>
              <small>{item.category || 'Sem categoria'}</small>
            </div>
            <span className="scope-cell">
              <span className={`scope-badge ${item.financial_scope || 'personal'}`}>{formatScope(item)}</span>
              <small>{formatSource(item)} · {formatFinancialType(item)}{item.is_recurring ? ` · ${recurrenceLabels[item.recurrence_frequency] || 'Recorrente'}` : ''}</small>
            </span>
            <span>{getProjectName(item)}</span>
            <span>{formatDate(getMovementDate(item))}</span>
            <strong>{formatCurrency(getMovementValue(item))}</strong>
            <span className={`status ${item.status}`}>{statusLabels[item.status] || item.status}</span>
            <div className="row-actions">
              <button type="button" className="actions-trigger" onClick={() => setActionTransaction(item)}>Ações</button>
            </div>
          </article>
        ))}
        {rows.length === 0 && <p className="empty-msg">Nenhum lançamento encontrado.</p>}
      </div>
    );
  }

  const showProjectField = ['revenue', 'payment_received', 'work_expense', 'transfer', 'reimbursement'].includes(entryKind);
  const showRevenueFields = entryKind === 'revenue';
  const showPaymentFields = entryKind === 'payment_received';
  const showPersonalExpenseFields = entryKind === 'personal_expense';
  const showTransferFields = entryKind === 'transfer';
  const showReimbursementFields = entryKind === 'reimbursement';
  const showWorkExpenseFields = entryKind === 'work_expense';
  const showRecurringFields = showPersonalExpenseFields;

  return (
    <div className="personal-finance-container">
      <header className="page-header">
        <div>
          <h1>Meu Financeiro</h1>
          <p>Controle privado das suas receitas, despesas pessoais, projetos, repasses e previsões.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      {actionTransaction && (
        <div className="action-modal-backdrop" onClick={() => setActionTransaction(null)}>
          <div className="action-modal" role="dialog" aria-modal="true" aria-label="Ações do lançamento" onClick={event => event.stopPropagation()}>
            <header>
              <div>
                <span>Ações do lançamento</span>
                <strong>{actionTransaction.description}</strong>
              </div>
              <button type="button" className="modal-close" onClick={() => setActionTransaction(null)}>x</button>
            </header>
            <div className="action-summary">
              <span>{formatDate(actionTransaction.date)}</span>
              <span>{statusLabels[actionTransaction.status] || actionTransaction.status}</span>
              <strong>{formatCurrency(actionTransaction.amount)}</strong>
            </div>
            <div className="action-modal-grid">
              <button type="button" onClick={() => handleActionEdit(actionTransaction)}>Editar lançamento</button>
              {actionTransaction.status !== 'paid' && <button type="button" onClick={() => handleActionStatus('paid')}>Marcar como pago</button>}
              {actionTransaction.status !== 'expected' && <button type="button" onClick={() => handleActionStatus('expected')}>Voltar para previsto</button>}
              {actionTransaction.status !== 'canceled' && <button type="button" onClick={() => handleActionStatus('canceled')}>Cancelar lançamento</button>}
              <button type="button" className="danger" onClick={handleActionArchive}>Arquivar lançamento</button>
            </div>
          </div>
        </div>
      )}

      <section className="context-tabs" aria-label="Contextos do financeiro">
        {contextTabs.map(tab => (
          <button
            key={tab.value}
            type="button"
            className={contextTab === tab.value ? 'active' : ''}
            onClick={() => setContextTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      <section className="personal-summary compact">
        {mainKpis.map(card => (
          <div key={card.label} className={`summary-card ${card.tone || ''}`}>
            <span>{card.label}</span>
            <strong>{formatCurrency(card.value)}</strong>
          </div>
        ))}
      </section>

      {contextTab === 'overview' && (
        <div className="kpi-toggle">
          <button type="button" onClick={() => setShowDetailedKpis(value => !value)}>
            {showDetailedKpis ? 'Ocultar indicadores detalhados' : 'Ver indicadores detalhados'}
          </button>
        </div>
      )}

      {contextTab === 'overview' && showDetailedKpis && (
        <section className="personal-summary detailed">
          {detailedKpis.map(card => (
            <div key={card.label} className={`summary-card ${card.tone || ''}`}>
              <span>{card.label}</span>
              <strong>{formatCurrency(card.value)}</strong>
            </div>
          ))}
        </section>
      )}

      <section className="finance-toolbar">
        <select value={periodMode} onChange={e => applyPeriod(e.target.value)}>
          <option value="all">Todos os períodos</option>
          <option value="current">Este mês</option>
          <option value="specific">Mês específico</option>
          <option value="year">Ano</option>
          <option value="custom">Período personalizado</option>
        </select>

        {periodMode === 'specific' && (
          <>
            <select value={filters.month} onChange={e => setFilters({ ...filters, month: e.target.value })}>
              {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0')).map(month => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
            <input value={filters.year} onChange={e => setFilters({ ...filters, year: e.target.value })} placeholder="Ano" />
          </>
        )}

        {periodMode === 'year' && (
          <input value={filters.year} onChange={e => setFilters({ ...filters, year: e.target.value })} placeholder="Ano" />
        )}

        {periodMode === 'custom' && (
          <>
            <input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
            <input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
          </>
        )}

        <button type="button" className="btn-secondary" onClick={() => setShowAdvancedFilters(value => !value)}>
          Filtros avançados
        </button>
        <button type="button" className="btn-secondary" onClick={() => setIsStatusModalOpen(true)}>
          Atualizar saldos
        </button>
        <button type="button" className="btn-primary" onClick={() => openTransactionModal()}>
          + Novo lançamento
        </button>
      </section>

      {showAdvancedFilters && (
        <section className="filters-panel advanced-filters">
          <select value={filters.financial_scope} onChange={e => setFilters({ ...filters, financial_scope: e.target.value })}>
            <option value="">Todos os escopos</option>
            <option value="personal">Pessoal</option>
            <option value="work">Trabalho</option>
            <option value="project">Projetos</option>
          </select>
          <select value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}>
            <option value="">Todos os tipos</option>
            <option value="income">Receitas</option>
            <option value="expense">Despesas</option>
          </select>
          <select value={filters.financial_type} onChange={e => setFilters({ ...filters, financial_type: e.target.value })}>
            <option value="">Todos financeiros</option>
            <option value="personal_expense">Despesas pessoais</option>
            <option value="transfer">Repasses</option>
            <option value="revenue">Receita / NF</option>
            <option value="payment_received">Pagamento recebido</option>
            <option value="operational_expense">Despesa operacional</option>
            <option value="reimbursement">Reembolso</option>
          </select>
          <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })} placeholder="Categoria" />
          <select value={filters.source} onChange={e => setFilters({ ...filters, source: e.target.value })}>
            <option value="">Todas as origens</option>
            {Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={filters.project_id} onChange={e => setFilters({ ...filters, project_id: e.target.value })}>
            <option value="">Todos os projetos</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.name || project.title}</option>)}
          </select>
          <select value={filters.is_recurring} onChange={e => setFilters({ ...filters, is_recurring: e.target.value })}>
            <option value="">Todos</option>
            <option value="1">Recorrentes</option>
          </select>
        </section>
      )}

      {isTransactionModalOpen && (
        <div className="action-modal-backdrop drawer-backdrop" onClick={resetTransactionForm}>
          <aside className="transaction-drawer" role="dialog" aria-modal="true" aria-label={editing ? 'Editar lançamento' : 'Novo lançamento'} onClick={event => event.stopPropagation()}>
            <header>
              <div>
                <span>{editing ? 'Editar lançamento' : 'Novo lançamento'}</span>
                <strong>{entryKind ? entryKinds.find(kind => kind.value === entryKind)?.label : 'O que você quer registrar?'}</strong>
              </div>
              <button type="button" className="modal-close" onClick={resetTransactionForm}>x</button>
            </header>

            {!entryKind && (
              <div className="choice-grid">
                {entryKinds.map(kind => (
                  <button key={kind.value} type="button" onClick={() => selectEntryKind(kind.value)}>
                    {kind.label}
                  </button>
                ))}
              </div>
            )}

            {entryKind && (
              <form onSubmit={handleSaveTransaction} className="drawer-form">
                <label>
                  Descrição
                  <input value={transactionForm.description} onChange={e => setTransactionForm({ ...transactionForm, description: e.target.value })} placeholder="Descrição" required />
                </label>

                {showProjectField && (
                  <label>
                    Projeto
                    <select value={transactionForm.project_id} onChange={e => setTransactionForm({ ...transactionForm, project_id: e.target.value })}>
                      <option value="">Sem projeto</option>
                      {projects.map(project => <option key={project.id} value={project.id}>{project.name || project.title}</option>)}
                    </select>
                  </label>
                )}

                <label>
                  Categoria
                  <select value={transactionForm.category} onChange={e => setTransactionForm({ ...transactionForm, category: e.target.value })}>
                    {categories.map(category => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>

                {showRevenueFields && (
                  <div className="form-row three">
                    <label>
                      Valor bruto
                      <input value={transactionForm.gross_amount} onChange={e => setTransactionForm({ ...transactionForm, gross_amount: e.target.value, amount: e.target.value })} placeholder="R$ 0,00" />
                    </label>
                    <label>
                      Minha parte
                      <input value={transactionForm.own_amount} onChange={e => setTransactionForm({ ...transactionForm, own_amount: e.target.value })} placeholder="R$ 0,00" />
                    </label>
                    <label>
                      Repasse previsto
                      <input value={transactionForm.transfer_amount} onChange={e => setTransactionForm({ ...transactionForm, transfer_amount: e.target.value })} placeholder="R$ 0,00" />
                    </label>
                  </div>
                )}

                {!showRevenueFields && (
                  <label>
                    {showPaymentFields ? 'Valor recebido' : showTransferFields ? 'Valor do repasse' : showReimbursementFields ? 'Valor do reembolso' : 'Valor'}
                    <input value={transactionForm.amount} onChange={e => setTransactionForm({ ...transactionForm, amount: e.target.value })} placeholder="R$ 0,00" required />
                  </label>
                )}

                {showTransferFields && (
                  <label>
                    Pessoa favorecida
                    <input value={transactionForm.origin_label} onChange={e => setTransactionForm({ ...transactionForm, origin_label: e.target.value })} placeholder="Nome da pessoa ou parceiro" />
                  </label>
                )}

                <div className="form-row two">
                  <label>
                    {showPaymentFields ? 'Data do recebimento' : showPersonalExpenseFields ? 'Vencimento' : showTransferFields ? 'Previsão de pagamento' : 'Data'}
                    <input type="date" value={transactionForm.date} onChange={e => setTransactionForm({ ...transactionForm, date: e.target.value })} required />
                  </label>
                  {(showRevenueFields || showWorkExpenseFields || showReimbursementFields) && (
                    <label>
                      Previsão de pagamento
                      <input type="date" value={transactionForm.payment_due_date} onChange={e => setTransactionForm({ ...transactionForm, payment_due_date: e.target.value })} />
                    </label>
                  )}
                  {(transactionForm.status === 'paid' || showPaymentFields) && (
                    <label>
                      Data de pagamento
                      <input type="date" value={transactionForm.paid_at} onChange={e => setTransactionForm({ ...transactionForm, paid_at: e.target.value })} />
                    </label>
                  )}
                </div>

                <div className="form-row two">
                  <label>
                    Status
                    <select value={transactionForm.status} onChange={e => setTransactionForm({ ...transactionForm, status: e.target.value })}>
                      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>
                    Forma de pagamento
                    <input value={transactionForm.payment_method} onChange={e => setTransactionForm({ ...transactionForm, payment_method: e.target.value })} placeholder="PIX, cartão, boleto..." />
                  </label>
                </div>

                {showProjectField && (
                  <label>
                    Visibilidade financeira
                    <select
                      value={transactionForm.visibility || 'private'}
                      onChange={e => setTransactionForm({
                        ...transactionForm,
                        visibility: e.target.value,
                        shared_with_project_owner: e.target.value === 'shared_with_owner'
                      })}
                    >
                      <option value="private">Privado</option>
                      <option value="shared_with_owner">Compartilhar com responsável financeiro</option>
                      <option value="shared_with_financial_manager">Compartilhar com pessoas financeiras autorizadas</option>
                      <option value="shared_with_project">Compartilhar com o projeto</option>
                    </select>
                  </label>
                )}

                {showPersonalExpenseFields && (
                  <>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={transactionForm.is_recurring} onChange={e => setTransactionForm({ ...transactionForm, is_recurring: e.target.checked })} />
                      Recorrente
                    </label>
                    {showRecurringFields && transactionForm.is_recurring && (
                      <label>
                        Frequência
                        <select value={transactionForm.recurrence_frequency} onChange={e => setTransactionForm({ ...transactionForm, recurrence_frequency: e.target.value })}>
                          <option value="">Frequência</option>
                          <option value="monthly">Mensal</option>
                          <option value="weekly">Semanal</option>
                          <option value="yearly">Anual</option>
                        </select>
                      </label>
                    )}
                  </>
                )}

                {isManualOrigin && !showTransferFields && (
                  <label>
                    Nome da origem
                    <input className="origin-label-input" value={transactionForm.origin_label} onChange={e => setTransactionForm({ ...transactionForm, origin_label: e.target.value })} placeholder="Freelance, PIX recebido, caixa..." />
                  </label>
                )}

                <label>
                  Observação
                  <textarea value={transactionForm.notes} onChange={e => setTransactionForm({ ...transactionForm, notes: e.target.value })} placeholder="Observação opcional" />
                </label>

                <div className="drawer-actions">
                  <button type="button" className="btn-cancel" onClick={resetTransactionForm}>Cancelar</button>
                  <button type="submit">{editing ? 'Salvar alterações' : 'Adicionar lançamento'}</button>
                </div>
              </form>
            )}
          </aside>
        </div>
      )}

      {isStatusModalOpen && (
        <div className="action-modal-backdrop" onClick={() => setIsStatusModalOpen(false)}>
          <div className="action-modal balance-modal" role="dialog" aria-modal="true" aria-label="Atualizar saldos" onClick={event => event.stopPropagation()}>
            <header>
              <div>
                <span>Atualizar saldos</span>
                <strong>Indicadores manuais</strong>
              </div>
              <button type="button" className="modal-close" onClick={() => setIsStatusModalOpen(false)}>x</button>
            </header>
            <form onSubmit={handleSaveStatus}>
              <label>Saldo total em bancos</label>
              <input value={statusForm.total_bank_balance} onChange={e => setStatusForm({ ...statusForm, total_bank_balance: e.target.value })} />
              <label>Dívida total</label>
              <input value={statusForm.total_debt} onChange={e => setStatusForm({ ...statusForm, total_debt: e.target.value })} />
              <label>Fatura do cartão</label>
              <input value={statusForm.credit_card_bill} onChange={e => setStatusForm({ ...statusForm, credit_card_bill: e.target.value })} />
              <button type="submit">Salvar saldos</button>
            </form>
          </div>
        </div>
      )}

      <section className="transactions-panel">
        <div className="panel-title-row">
          <div>
            <h2>Movimentações</h2>
            <p>Receitas, despesas, repasses e previsões do contexto selecionado.</p>
          </div>
        </div>
        <div className="movement-tabs">
          {movementTabs.map(tab => (
            <button
              key={tab.value}
              type="button"
              className={movementTab === tab.value ? 'active' : ''}
              onClick={() => setMovementTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {renderRows(visibleTransactions)}
      </section>

      <section className="renegotiations-panel">
        <h2>Renegociacoes</h2>
        <form onSubmit={handleCreateDebt} className="renegotiation-form">
          <input value={debtForm.description} onChange={e => setDebtForm({ ...debtForm, description: e.target.value })} placeholder="Descrição" required />
          <input value={debtForm.installment_value} onChange={e => setDebtForm({ ...debtForm, installment_value: e.target.value })} placeholder="Valor da parcela" required />
          <input type="number" value={debtForm.total_installments} onChange={e => setDebtForm({ ...debtForm, total_installments: e.target.value })} placeholder="Total de parcelas" />
          <input type="date" value={debtForm.start_date} onChange={e => setDebtForm({ ...debtForm, start_date: e.target.value })} required />
          <button type="submit">Adicionar</button>
        </form>
        <div className="renegotiations-list">
          {renegotiations.map(item => (
            <article key={item.id}>
              <div>
                <strong>{item.description}</strong>
                <span>Inicio em {formatDate(item.start_date)}</span>
              </div>
              <strong>{formatCurrency(item.installment_value)}</strong>
            </article>
          ))}
          {renegotiations.length === 0 && <p>Nenhuma renegociação cadastrada.</p>}
        </div>
      </section>
    </div>
  );
}
