import React, { useState } from 'react';
import api from '../../services/api';
import './styles.scss';

export default function ModalClient({ isOpen, onClose, onSuccess }) {
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [document, setDocument] = useState('');
  
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Se o modal não estiver aberto, não renderiza nada
  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await api.post('/clients', {
        name,
        contact_name: contactName,
        email,
        phone,
        document
      });

      // Limpa o formulário após o sucesso
      setName('');
      setContactName('');
      setEmail('');
      setPhone('');
      setDocument('');
      
      onSuccess(); // Atualiza a lista na página principal
      onClose();   // Fecha o modal
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao cadastrar cliente.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <header>
          <h2>Novo Cliente</h2>
          <button onClick={onClose} className="btn-close">×</button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="name">Nome / Empresa *</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="contactName">Pessoa de Contato</label>
            <input
              id="contactName"
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>

          <div className="input-row">
            <div className="input-group">
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label htmlFor="phone">Telefone</label>
              <input
                id="phone"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="document">CPF / CNPJ</label>
            <input
              id="document"
              type="text"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-cancel">
              Cancelar
            </button>
            <button type="submit" className="btn-save" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando...' : 'Salvar Cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}