import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import './styles.scss';

const emptyForm = {
  file_name: '',
  file_url: '',
  provider: 'drive',
  document_type: 'folder',
  description: '',
  visibility: 'individual',
  team_id: '',
  client_id: '',
  project_id: '',
  invoice_id: ''
};

const providerLabels = { drive: 'Drive', external: 'Externo', other: 'Outro' };
const typeLabels = {
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

const quickFilters = [
  { key: 'all', label: 'Todos', filters: { document_type: '', provider: '', status: 'active' } },
  { key: 'contracts', label: 'Contratos', filters: { document_type: 'contract', provider: '', status: 'active' } },
  { key: 'invoices', label: 'NFs', filters: { document_type: 'invoice', provider: '', status: 'active' } },
  { key: 'receipts', label: 'Comprovantes', filters: { document_type: 'receipt', provider: '', status: 'active' } },
  { key: 'links', label: 'Links', filters: { document_type: '', provider: 'external', status: 'active' } },
  { key: 'internal', label: 'Drive/Pastas', filters: { document_type: 'folder', provider: 'drive', status: 'active' } },
  { key: 'archived', label: 'Arquivados', filters: { document_type: '', provider: '', status: 'archived' } }
];

export default function Documents() {
  const [documents, setDocuments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState({
    status: 'active',
    search: '',
    document_type: '',
    provider: '',
    team_id: '',
    client_id: '',
    project_id: '',
    invoice_id: ''
  });
  const [form, setForm] = useState(emptyForm);

  const loadDocuments = useCallback(async () => {
    try {
      const query = new URLSearchParams(
        Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
      ).toString();
      const [docsRes, teamsRes, clientsRes, projectsRes, invoicesRes] = await Promise.all([
        api.get(`/documents?${query}`),
        api.get('/teams'),
        api.get('/clients?status=all'),
        api.get('/projects?status=all'),
        api.get('/invoices')
      ]);
      setDocuments(docsRes.data);
      setTeams(teamsRes.data);
      setClients(clientsRes.data);
      setProjects(projectsRes.data);
      setInvoices(invoicesRes.data);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao carregar documentos.');
    }
  }, [filters]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  function resetForm() {
    setForm(emptyForm);
    setEditing(null);
  }

  function startEdit(document) {
    setEditing(document);
    setForm({
      file_name: document.file_name || '',
      file_url: document.file_url || '',
      provider: document.provider || 'external',
      document_type: document.document_type || 'other',
      description: document.description || '',
      visibility: document.team_id ? 'team' : 'individual',
      team_id: document.team_id || '',
      client_id: document.client_id || '',
      project_id: document.project_id || '',
      invoice_id: document.invoice_id || ''
    });
  }

  function handleProjectChange(projectId) {
    const project = projects.find(item => String(item.id) === String(projectId));
    setForm(current => ({
      ...current,
      project_id: projectId,
      client_id: project?.client_id || current.client_id,
      team_id: project?.team_id || current.team_id,
      visibility: project?.team_id ? 'team' : current.visibility
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFeedback('');

    const payload = {
      file_name: form.file_name,
      file_url: form.file_url,
      provider: form.provider,
      document_type: form.document_type,
      description: form.description,
      team_id: form.visibility === 'team' ? form.team_id : null,
      client_id: form.client_id || null,
      project_id: form.project_id || null,
      invoice_id: form.invoice_id || null
    };

    try {
      if (editing) {
        await api.put(`/documents/${editing.id}`, payload);
        setFeedback('Documento atualizado.');
      } else {
        await api.post('/documents', payload);
        setFeedback('Documento cadastrado.');
      }
      resetForm();
      await loadDocuments();
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao salvar documento.');
    }
  }

  async function handleArchive(document) {
    const confirmed = window.confirm('Deseja arquivar este documento? Ele podera ser restaurado depois.');
    if (!confirmed) return;
    try {
      await api.patch(`/documents/${document.id}/archive`);
      await loadDocuments();
      setFeedback('Documento arquivado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao arquivar documento.');
    }
  }

  async function handleRestore(document) {
    try {
      await api.patch(`/documents/${document.id}/restore`);
      await loadDocuments();
      setFeedback('Documento restaurado.');
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Erro ao restaurar documento.');
    }
  }

  const activeCount = documents.filter(item => item.archived !== 1).length;
  const archivedCount = documents.filter(item => item.archived === 1).length;

  function applyQuickFilter(preset) {
    setFilters(current => ({
      ...current,
      ...preset.filters
    }));
  }

  function clearFilters() {
    setFilters({
      status: 'active',
      search: '',
      document_type: '',
      provider: '',
      team_id: '',
      client_id: '',
      project_id: '',
      invoice_id: ''
    });
  }

  return (
    <div className="documents-container">
      <header className="page-header">
        <div>
          <h1>Documentos</h1>
          <p>Links externos, Drive e comprovantes vinculados a clientes, projetos, notas e times.</p>
        </div>
      </header>

      {feedback && <div className="feedback-message">{feedback}</div>}

      <section className="documents-summary">
        <div><span>Total filtrado</span><strong>{documents.length}</strong></div>
        <div><span>Ativos</span><strong>{activeCount}</strong></div>
        <div><span>Arquivados</span><strong>{archivedCount}</strong></div>
      </section>

      <section className="documents-quick-filters" aria-label="Filtros rapidos de documentos">
        {quickFilters.map(preset => (
          <button
            key={preset.key}
            type="button"
            className={
              filters.document_type === preset.filters.document_type &&
              filters.provider === preset.filters.provider &&
              filters.status === preset.filters.status
                ? 'active'
                : ''
            }
            onClick={() => applyQuickFilter(preset)}
          >
            {preset.label}
          </button>
        ))}
      </section>

      <section className="documents-filters">
        <input
          value={filters.search}
          onChange={e => setFilters({ ...filters, search: e.target.value })}
          placeholder="Buscar por nome, cliente, projeto, NF ou link"
        />
        <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="active">Ativos</option>
          <option value="archived">Arquivados</option>
          <option value="all">Todos</option>
        </select>
        <select value={filters.document_type} onChange={e => setFilters({ ...filters, document_type: e.target.value })}>
          <option value="">Todos os tipos</option>
          {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={filters.provider} onChange={e => setFilters({ ...filters, provider: e.target.value })}>
          <option value="">Todos providers</option>
          {Object.entries(providerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={filters.team_id} onChange={e => setFilters({ ...filters, team_id: e.target.value })}>
          <option value="">Todos os times</option>
          {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        <select value={filters.client_id} onChange={e => setFilters({ ...filters, client_id: e.target.value })}>
          <option value="">Todos os clientes</option>
          {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
        <select value={filters.project_id} onChange={e => setFilters({ ...filters, project_id: e.target.value })}>
          <option value="">Todos os projetos</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
        <select value={filters.invoice_id} onChange={e => setFilters({ ...filters, invoice_id: e.target.value })}>
          <option value="">Todas as NFs</option>
          {invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.number || `NF ${invoice.id}`} - {invoice.client_name}</option>)}
        </select>
        <button type="button" onClick={clearFilters}>Limpar filtros</button>
      </section>

      <section className="document-form-panel">
        <h2>{editing ? 'Editar documento' : 'Novo documento'}</h2>
        <form onSubmit={handleSubmit}>
          <input value={form.file_name} onChange={e => setForm({ ...form, file_name: e.target.value })} placeholder="Nome do documento" required />
          <input value={form.file_url} onChange={e => setForm({ ...form, file_url: e.target.value })} placeholder="https://..." required />
          <select value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}>
            {Object.entries(providerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={form.document_type} onChange={e => setForm({ ...form, document_type: e.target.value })}>
            {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descricao" />
          <select value={form.visibility} onChange={e => setForm({ ...form, visibility: e.target.value, team_id: '' })}>
            <option value="individual">Individual</option>
            <option value="team">Time</option>
          </select>
          {form.visibility === 'team' && (
            <select value={form.team_id} onChange={e => setForm({ ...form, team_id: e.target.value })} required>
              <option value="">Selecione o time</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          )}
          <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
            <option value="">Sem cliente</option>
            {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
          <select value={form.project_id} onChange={e => handleProjectChange(e.target.value)}>
            <option value="">Sem projeto</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
          <select value={form.invoice_id} onChange={e => setForm({ ...form, invoice_id: e.target.value })}>
            <option value="">Sem nota fiscal</option>
            {invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.number || `NF ${invoice.id}`} - {invoice.client_name}</option>)}
          </select>
          <button type="submit">{editing ? 'Salvar alteracoes' : 'Cadastrar'}</button>
          {editing && <button type="button" className="btn-cancel" onClick={resetForm}>Cancelar</button>}
        </form>
      </section>

      <section className="documents-list">
        {documents.map(document => (
          <article key={document.id} className={document.archived === 1 ? 'archived' : ''}>
            <div>
              <strong>{document.file_name}</strong>
              <p>{document.description || document.file_url}</p>
              <div className="doc-badges">
                <small>{providerLabels[document.provider] || document.provider}</small>
                <small>{typeLabels[document.document_type] || document.document_type}</small>
                <small>{document.team_id ? `Time: ${document.team_name}` : 'Individual'}</small>
                {document.client_name && <small>{document.client_name}</small>}
                {document.project_title && <small>{document.project_title}</small>}
                {document.invoice_number && <small>NF: {document.invoice_number}</small>}
                {document.archived === 1 && <small className="archived-badge">Arquivado</small>}
              </div>
            </div>
            <div className="doc-actions">
              <a href={document.file_url} target="_blank" rel="noreferrer">Abrir</a>
              {document.can_edit ? (
                <>
                  {document.archived !== 1 && <button onClick={() => startEdit(document)}>Editar</button>}
                  {document.archived !== 1 && <button className="danger" onClick={() => handleArchive(document)}>Arquivar</button>}
                  {document.archived === 1 && <button className="restore" onClick={() => handleRestore(document)}>Restaurar</button>}
                </>
              ) : (
                <button disabled>Somente leitura</button>
              )}
            </div>
          </article>
        ))}
        {documents.length === 0 && <p className="empty-msg">Nenhum documento encontrado.</p>}
      </section>
    </div>
  );
}
