// utilities
const Utils = {
  generateId: () => `note_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
  formatDate: (d) => new Date(d).toLocaleDateString(),
  delay: (ms) => new Promise(res => setTimeout(res, ms)),
  debounce: (fn, delay) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }
};

// storage module
const Storage = (() => {
  const KEY = 'notes_app_data';
  return {
    save: (data) => localStorage.setItem(KEY, JSON.stringify(data)),
    load: () => JSON.parse(localStorage.getItem(KEY)),
    clear: () => localStorage.removeItem(KEY)
  };
})();

// fake api
const FakeAPI = (() => {
  const getRawData = () => Storage.load() || window.initialNotes || [];

  return {
    getNotes: async (page, limit, category, search) => {
      // Network Delay (300-800ms)
      const ms = Math.floor(Math.random() * 500) + 300;
      await Utils.delay(ms);

      let data = [...getRawData()];

      // 1. Filter by Category
      if (category !== 'all') {
        data = data.filter(n => n.category === category);
      }

      // 2. Search logic (Title or Text)
      if (search) {
        const term = search.toLowerCase();
        data = data.filter(n => 
          n.title.toLowerCase().includes(term) || 
          n.text.toLowerCase().includes(term)
        );
      }

      // 3. Sort - newest first
      data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // 4. Pagination
      const start = (page - 1) * limit;
      return {
        notes: data.slice(start, start + limit),
        hasMore: start + limit < data.length,
        total: data.length
      };
    },

    createNote: async (noteData) => {
      await Utils.delay(400);
      const notes = getRawData();
      const newNote = { ...noteData, id: Utils.generateId(), createdAt: new Date().toISOString() };
      Storage.save([newNote, ...notes]);
      return newNote;
    },

    updateNote: async (id, updates) => {
      await Utils.delay(400);
      const notes = getRawData();
      const idx = notes.findIndex(n => n.id === id);
      if (idx !== -1) {
        notes[idx] = { ...notes[idx], ...updates };
        Storage.save(notes);
        return notes[idx];
      }
    },

    deleteNote: async (id) => {
      await Utils.delay(400);
      const notes = getRawData().filter(n => n.id !== id);
      Storage.save(notes);
    }
  };
})();

// IIFE
const App = (() => {
  // State
  let state = {
    notes: [],
    page: 1,
    limit: 6,
    category: 'all',
    search: '',
    hasMore: true,
    isLoading: false,
    lastRequestId: 0 // Race condition protection
  };

  let deleteId = null;

  // UI Elements
  const list = document.getElementById('notes-list');
  const form = document.getElementById('note-form');
  const sentinel = document.getElementById('sentinel');

  const renderCard = (note) => {
    const { id, title, text, category, createdAt } = note;
    return `
      <article class="note-card" data-id="${id}" data-category="${category}">
        <div class="note-header">
          <h3 class="note-title">${title}</h3>
          <div class="note-actions">
            <button class="edit-btn">✏️</button>
            <button class="delete-btn">🗑️</button>
          </div>
        </div>
        <p class="note-text">${text}</p>
        <div class="note-meta">
          <span class="note-category ${category}">${category}</span>
          <span class="note-date">${Utils.formatDate(createdAt)}</span>
        </div>
      </article>`;
  };

  const loadNotes = async (append = false) => {
    if (state.isLoading) return;
    
    const requestId = ++state.lastRequestId;
    state.isLoading = true;
    document.getElementById('loading').classList.remove('hidden');

    try {
      const result = await FakeAPI.getNotes(state.page, state.limit, state.category, state.search);
      
      // Abandon if a newer request was made (Race Condition fix)
      if (requestId !== state.lastRequestId) return;

      state.hasMore = result.hasMore;
      const html = result.notes.map(n => renderCard(n)).join('');
      
      if (append) list.innerHTML += html;
      else list.innerHTML = html;

      document.getElementById('total-count').textContent = result.total;
      document.getElementById('empty-state').classList.toggle('hidden', result.total > 0);
    } catch (err) {
      console.error("Load failed", err);
    } finally {
      state.isLoading = false;
      document.getElementById('loading').classList.add('hidden');
    }
  };

  const resetAndLoad = () => {
    state.page = 1;
    state.hasMore = true;
    window.scrollTo(0, 0);
    loadNotes(false);
  };

  const init = () => {
    // Infinite Scroll
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && state.hasMore && !state.isLoading) {
        state.page++;
        loadNotes(true);
      }
    }, { threshold: 0.1 });
    observer.observe(sentinel);

    // Event Delegation for Edit/Delete
    list.addEventListener('click', (e) => {
      const card = e.target.closest('.note-card');
      if (!card) return;
      const id = card.dataset.id;

      if (e.target.classList.contains('delete-btn')) {
        deleteId = id;
        document.getElementById('delete-modal').classList.remove('hidden');
      }

      if (e.target.classList.contains('edit-btn')) {
        const notes = Storage.load() || window.initialNotes;
        const note = notes.find(n => n.id === id);
        document.getElementById('note-id').value = note.id;
        document.getElementById('note-title').value = note.title;
        document.getElementById('note-text').value = note.text;
        document.getElementById('note-category').value = note.category;
        document.getElementById('form-btn-text').textContent = "Update Note";
        document.getElementById('cancel-btn').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    // Real-time Search with Debounce
    document.getElementById('search-input').addEventListener('input', Utils.debounce((e) => {
      state.search = e.target.value;
      resetAndLoad();
    }, 400));

    // Category Filters
    document.querySelector('.filters').addEventListener('click', (e) => {
      if (!e.target.classList.contains('filter-btn')) return;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.category = e.target.dataset.filter;
      resetAndLoad();
    });

    // Form Submit (Create/Update)
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('note-id').value;
      const data = {
        title: document.getElementById('note-title').value,
        text: document.getElementById('note-text').value,
        category: document.getElementById('note-category').value
      };

      if (id) await FakeAPI.updateNote(id, data);
      else await FakeAPI.createNote(data);

      form.reset();
      document.getElementById('note-id').value = "";
      document.getElementById('form-btn-text').textContent = "Add Note";
      resetAndLoad();
    });

    // Delete Modal
    document.getElementById('confirm-delete').onclick = async () => {
      await FakeAPI.deleteNote(deleteId);
      document.getElementById('delete-modal').classList.add('hidden');
      resetAndLoad();
    };

    document.getElementById('cancel-delete').onclick = () => {
      document.getElementById('delete-modal').classList.add('hidden');
    };

    loadNotes();
  };

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
