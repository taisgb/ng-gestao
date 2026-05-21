import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

const STATUS_OPTIONS = ['pendente', 'emitida', 'enviada', 'paga', 'cancelada'];
const statusLabels = {
  pendente: 'Pendente',
  emitida: 'Emitida',
  enviada: 'Enviada',
  paga: 'Paga',
  cancelada: 'Cancelada'
};
const documentProviderLabels = { drive: 'Drive', external: 'Externo', other: 'Outro' };
const documentTypeLabels = {
  invoice: 'Nota fiscal',
  receipt: 'Comprovante',
  contract: 'Contrato',
  briefing: 'Briefing',
  artwork: 'Arte',
  image: 'Imagem',
  boleto: 'Boleto',
  folder: 'Pasta',
  other: 'Outro'
};

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [projects, setProjects] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear()));
  const [fiscalSettings, setFiscalSettings] = useState({ company_type: 'mei', opening_date: '', use_proportional_limit: 0 });
  const [fiscalSummary, setFiscalSummary] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceDocuments, setInvoiceDocuments] = useState([]);
  const [invoiceDocumentForm, setInvoiceDocumentForm] = useState({
    file_name: '',
    file_url: '',
    provider: 'drive',
    document_type: 'invoice',
    description: ''
  });
  const [form, setForm] = useState({
    number: '',
    client_name: '',
    description: '',
    amount: '',
    issue_date: new Date().toISOString().split('T')[0],
    status: 'pendente',
    project_id: ''
  });

  async function loadData() {
    try {
      const [invoicesRes, projectsRes] = await Promise.all([
        api.get('/invoices'),
        api.get('/projects')
      ]);
      setInvoices(invoicesRes.data);
      setProjects(projectsRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar notas fiscais.');
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const loadFiscalData = useCallback(async () => {
    try {
      const [settingsRes, summaryRes] = await Promise.all([
        api.get('/invoices/fiscal-settings'),
        api.get(`/invoices/summary?year=${fiscalYear}`)
      ]);
      setFiscalSettings(settingsRes.data);
      setFiscalSummary(summaryRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar resumo fiscal.');
    }
  }, [fiscalYear]);

  useEffect(() => {
    loadFiscalData();
  }, [loadFiscalData]);

  const visibleInvoices = useMemo(() => {
    if (!filterStatus) return invoices;
    return invoices.filter(invoice => invoice.status === filterStatus);
  }, [invoices, filterStatus]);

  const financialProjects = useMemo(
    () => projects.filter(project => project.can_view_financials !== false),
    [projects]
  );

  const summary = useMemo(() => {
    return visibleInvoices.reduce((acc, invoice) => {
      acc.total += Number(invoice.amount || 0);
      acc[invoice.status] = (acc[invoice.status] || 0) + 1;
      return acc;
    }, { total: 0 });
  }, [visibleInvoices]);

  async function handleCreate(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/invoices', {
        ...form,
        amount: Number(form.amount || 0),
        project_id: form.project_id || null
      });
      setForm({
        number: '',
        client_name: '',
        description: '',
        amount: '',
        issue_date: new Date().toISOString().split('T')[0],
        status: 'pendente',
        project_id: ''
      });
      await loadData();
      await loadFiscalData();
      setFeedback('Nota fiscal registrada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao registrar nota fiscal.');
    }
  }

  async function handleStatus(invoice, status) {
    await api.put(`/invoices/${invoice.id}`, { status });
    setInvoices(current => current.map(item => item.id === invoice.id ? { ...item, status } : item));
    await loadFiscalData();
  }

  async function handleDelete(id) {
    await api.delete(`/invoices/${id}`);
    setInvoices(current => current.filter(invoice => invoice.id !== id));
    await loadFiscalData();
  }

  async function loadInvoiceDocuments(invoice) {
    setSelectedInvoice(invoice);
    try {
      const response = await api.get(`/invoices/${invoice.id}/documents?status=all`);
      setInvoiceDocuments(response.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar documentos da nota fiscal.');
    }
  }

  async function handleCreateInvoiceDocument(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.post('/documents', {
        ...invoiceDocumentForm,
        invoice_id: selectedInvoice.id,
        project_id: selectedInvoice.project_id || null
      });
      setInvoiceDocumentForm({
        file_name: '',
        file_url: '',
        provider: 'drive',
        document_type: 'invoice',
        description: ''
      });
      await loadInvoiceDocuments(selectedInvoice);
      setFeedback('Documento da NF cadastrado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao cadastrar documento da NF.');
    }
  }

  async function handleArchiveInvoiceDocument(document) {
    const confirmed = window.confirm('Deseja arquivar este documento? Ele poderá ser restaurado depois.');
    if (!confirmed) return;

    try {
      await api.patch(`/documents/${document.id}/archive`);
      await loadInvoiceDocuments(selectedInvoice);
      setFeedback('Documento arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar documento.');
    }
  }

  async function handleRestoreInvoiceDocument(document) {
    try {
      await api.patch(`/documents/${document.id}/restore`);
      await loadInvoiceDocuments(selectedInvoice);
      setFeedback('Documento restaurado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao restaurar documento.');
    }
  }

  async function handleFiscalSave(e) {
    e.preventDefault();
    setFeedback('');

    try {
      await api.put('/invoices/fiscal-settings', fiscalSettings);
      await loadFiscalData();
      setFeedback('Configuração fiscal salva.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar configuração fiscal.');
    }
  }

  function exportCsv() {
    const headers = ['Número', 'Cliente', 'Descrição', 'Projeto', 'Valor', 'Emissão', 'Status'];
    const rows = visibleInvoices.map(invoice => [
      invoice.number || '',
      invoice.client_name || '',
      invoice.description || '',
      invoice.project_title || '',
      Number(invoice.amount || 0).toFixed(2).replace('.', ','),
      invoice.issue_date || '',
      invoice.status || ''
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';'))
      .join('\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `notas-fiscais-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const formatCurrency = value =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

  return (
    <div className="invoices-container">
      <header className="page-header">
        <div>
          <h1>Notas Fiscais</h1>
          <p>Controle de NFs emitidas, status e exportação para planilha.</p>
        </div>
        <button onClick={exportCsv}>Exportar planilha</button>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="invoice-summary">
        <div><span>Total filtrado</span><strong>{formatCurrency(summary.total)}</strong></div>
        <div><span>Pendentes</span><strong>{summary.pendente || 0}</strong></div>
        <div><span>Emitidas</span><strong>{summary.emitida || 0}</strong></div>
        <div><span>Pagas</span><strong>{summary.paga || 0}</strong></div>
        <div><span>Limite anual</span><strong>{formatCurrency(fiscalSummary?.annual_revenue_limit)}</strong></div>
        <div><span>Faturado no ano</span><strong>{formatCurrency(fiscalSummary?.total_revenue_year)}</strong></div>
        <div><span>Disponivel</span><strong>{formatCurrency(fiscalSummary?.remaining_limit)}</strong></div>
        <div><span>Utilizado</span><strong>{Number(fiscalSummary?.used_percentage || 0).toFixed(2)}%</strong></div>
      </section>

      <section className={`fiscal-card ${fiscalSummary?.alert_level || 'normal'}`}>
        <form onSubmit={handleFiscalSave}>
          <div>
            <h2>Enquadramento fiscal</h2>
            <p>
              {(fiscalSettings.company_type || 'mei').toUpperCase()} - limite anual {formatCurrency(fiscalSummary?.annual_revenue_limit)}
            </p>
          </div>
          <select
            value={fiscalSettings.company_type || 'mei'}
            onChange={e => setFiscalSettings(current => ({ ...current, company_type: e.target.value }))}
          >
            <option value="mei">MEI</option>
            <option value="me">ME / Microempresa</option>
          </select>
          <input
            type="date"
            value={fiscalSettings.opening_date || ''}
            onChange={e => setFiscalSettings(current => ({ ...current, opening_date: e.target.value }))}
          />
          <label>
            <input
              type="checkbox"
              checked={Boolean(fiscalSettings.use_proportional_limit)}
              onChange={e => setFiscalSettings(current => ({ ...current, use_proportional_limit: e.target.checked ? 1 : 0 }))}
            />
            Limite proporcional
          </label>
          <button type="submit">Salvar</button>
        </form>
        <div className="limit-progress">
          <div style={{ width: `${Math.min(100, Number(fiscalSummary?.used_percentage || 0))}%` }} />
        </div>
        <p>
          Você usou {Number(fiscalSummary?.used_percentage || 0).toFixed(2)}% do limite anual.
          {' '}Ainda restam {formatCurrency(fiscalSummary?.remaining_limit)} até o limite.
        </p>
        {fiscalSummary?.alert_level === 'warning' && <strong>Atenção: você está próximo do limite anual.</strong>}
        {fiscalSummary?.alert_level === 'danger' && <strong>Alerta: você está muito próximo do limite anual.</strong>}
        {fiscalSummary?.alert_level === 'exceeded' && <strong>Limite anual ultrapassado.</strong>}
      </section>

      <section className="invoice-form-panel">
        <form onSubmit={handleCreate}>
          <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="Número da NF" />
          <input value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} placeholder="Cliente" required />
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descrição" />
          <input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="Valor" required />
          <input type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} required />
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {STATUS_OPTIONS.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
          </select>
          <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>
            <option value="">Sem projeto</option>
            {financialProjects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
          <button type="submit">Registrar NF</button>
        </form>
      </section>

      <div className="filter-row">
        <select value={fiscalYear} onChange={e => setFiscalYear(e.target.value)}>
          {[2024, 2025, 2026, 2027].map(year => <option key={year} value={year}>{year}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
        </select>
      </div>

      {selectedInvoice && (
        <section className="invoice-documents-panel">
          <header>
            <div>
              <h2>Documentos da NF {selectedInvoice.number || selectedInvoice.id}</h2>
              <p>PDF da nota, comprovante, boleto, recibo ou link externo.</p>
            </div>
            <button onClick={() => setSelectedInvoice(null)}>Fechar</button>
          </header>

          <form onSubmit={handleCreateInvoiceDocument}>
            {selectedInvoice.can_edit ? (
              <>
                <input
                  value={invoiceDocumentForm.file_name}
                  onChange={e => setInvoiceDocumentForm({ ...invoiceDocumentForm, file_name: e.target.value })}
                  placeholder="Nome do documento"
                  required
                />
                <input
                  value={invoiceDocumentForm.file_url}
                  onChange={e => setInvoiceDocumentForm({ ...invoiceDocumentForm, file_url: e.target.value })}
                  placeholder="https://..."
                  required
                />
                <select value={invoiceDocumentForm.provider} onChange={e => setInvoiceDocumentForm({ ...invoiceDocumentForm, provider: e.target.value })}>
                  <option value="drive">Drive</option>
                  <option value="external">Externo</option>
                  <option value="other">Outro</option>
                </select>
                <select value={invoiceDocumentForm.document_type} onChange={e => setInvoiceDocumentForm({ ...invoiceDocumentForm, document_type: e.target.value })}>
                  <option value="invoice">Nota fiscal</option>
                  <option value="receipt">Comprovante</option>
                  <option value="boleto">Boleto</option>
                  <option value="folder">Pasta</option>
                  <option value="other">Outro</option>
                </select>
                <input
                  value={invoiceDocumentForm.description}
                  onChange={e => setInvoiceDocumentForm({ ...invoiceDocumentForm, description: e.target.value })}
                  placeholder="Descrição"
                />
                <button type="submit">Adicionar</button>
              </>
            ) : (
              <p className="readonly-note">Você pode visualizar os documentos desta NF, mas não pode anexar novos links.</p>
            )}
          </form>

          <div className="invoice-documents-list">
            {invoiceDocuments.map(document => (
              <article key={document.id} className={document.archived === 1 ? 'archived' : ''}>
                <div>
                  <strong>{document.file_name}</strong>
                  <span>{documentTypeLabels[document.document_type] || 'Outro'} - {documentProviderLabels[document.provider] || 'Outro'}{document.archived === 1 ? ' - Arquivado' : ''}</span>
                </div>
                <div>
                  <a href={document.file_url} target="_blank" rel="noreferrer">Abrir</a>
                  {document.can_edit && document.archived !== 1 && <button onClick={() => handleArchiveInvoiceDocument(document)}>Arquivar</button>}
                  {document.can_edit && document.archived === 1 && <button onClick={() => handleRestoreInvoiceDocument(document)}>Restaurar</button>}
                </div>
              </article>
            ))}
            {invoiceDocuments.length === 0 && <p className="empty-msg">Nenhum documento vinculado.</p>}
          </div>
        </section>
      )}

      <section className="invoice-list">
        {visibleInvoices.map(invoice => (
          <article key={invoice.id} className={`invoice-card ${invoice.status}`}>
            <div>
              <strong>{invoice.number ? `NF ${invoice.number}` : 'NF sem número'}</strong>
              <p>{invoice.client_name} - {invoice.project_title || 'Sem projeto'}</p>
              <span>{invoice.description || 'Sem descrição'}</span>
            </div>
            <div className="invoice-actions">
              <strong>{formatCurrency(invoice.amount)}</strong>
              <select value={invoice.status} disabled={!invoice.can_edit} onChange={e => handleStatus(invoice, e.target.value)}>
                {STATUS_OPTIONS.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
              </select>
              <button onClick={() => loadInvoiceDocuments(invoice)}>Docs</button>
              {invoice.can_edit ? (
                <button onClick={() => handleDelete(invoice.id)}>Remover</button>
              ) : (
                <button disabled>Somente leitura</button>
              )}
            </div>
          </article>
        ))}
        {visibleInvoices.length === 0 && <p className="empty-msg">Nenhuma nota fiscal encontrada.</p>}
      </section>
    </div>
  );
}
