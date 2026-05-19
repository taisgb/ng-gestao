import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

const STATUS_OPTIONS = ['pendente', 'emitida', 'enviada', 'paga', 'cancelada'];

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [projects, setProjects] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
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

  const visibleInvoices = useMemo(() => {
    if (!filterStatus) return invoices;
    return invoices.filter(invoice => invoice.status === filterStatus);
  }, [invoices, filterStatus]);

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
      setFeedback('Nota fiscal registrada.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao registrar nota fiscal.');
    }
  }

  async function handleStatus(invoice, status) {
    await api.put(`/invoices/${invoice.id}`, { status });
    setInvoices(current => current.map(item => item.id === invoice.id ? { ...item, status } : item));
  }

  async function handleDelete(id) {
    await api.delete(`/invoices/${id}`);
    setInvoices(current => current.filter(invoice => invoice.id !== id));
  }

  function exportCsv() {
    const headers = ['Numero', 'Cliente', 'Descricao', 'Projeto', 'Valor', 'Emissao', 'Status'];
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
          <p>Controle de NFs emitidas, status e exportacao para planilha.</p>
        </div>
        <button onClick={exportCsv}>Exportar planilha</button>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="invoice-summary">
        <div><span>Total filtrado</span><strong>{formatCurrency(summary.total)}</strong></div>
        <div><span>Pendentes</span><strong>{summary.pendente || 0}</strong></div>
        <div><span>Emitidas</span><strong>{summary.emitida || 0}</strong></div>
        <div><span>Pagas</span><strong>{summary.paga || 0}</strong></div>
      </section>

      <section className="invoice-form-panel">
        <form onSubmit={handleCreate}>
          <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="Numero da NF" />
          <input value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} placeholder="Cliente" required />
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descricao" />
          <input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="Valor" required />
          <input type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} required />
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>
            <option value="">Sem projeto</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
          <button type="submit">Registrar NF</button>
        </form>
      </section>

      <div className="filter-row">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>

      <section className="invoice-list">
        {visibleInvoices.map(invoice => (
          <article key={invoice.id} className={`invoice-card ${invoice.status}`}>
            <div>
              <strong>{invoice.number ? `NF ${invoice.number}` : 'NF sem numero'}</strong>
              <p>{invoice.client_name} - {invoice.project_title || 'Sem projeto'}</p>
              <span>{invoice.description || 'Sem descricao'}</span>
            </div>
            <div className="invoice-actions">
              <strong>{formatCurrency(invoice.amount)}</strong>
              <select value={invoice.status} onChange={e => handleStatus(invoice, e.target.value)}>
                {STATUS_OPTIONS.map(status => <option key={status} value={status}>{status}</option>)}
              </select>
              <button onClick={() => handleDelete(invoice.id)}>Remover</button>
            </div>
          </article>
        ))}
        {visibleInvoices.length === 0 && <p className="empty-msg">Nenhuma nota fiscal encontrada.</p>}
      </section>
    </div>
  );
}
