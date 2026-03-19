// ============================================
// XMPP MESSAGING APP - VERSION FINALE CORRIGÉE
// Tous les correctifs : scroll auto, dernier message, zone saisie fixe
// ============================================

const { client, xml, jid } = window.XMPP;

// ============================================
// DOM ELEMENTS
// ============================================
const loginScreen        = document.getElementById('login-screen');
const mainInterface      = document.getElementById('main-interface');
const connectBtn         = document.getElementById('connect-btn');
const logoutBtn          = document.getElementById('logout-btn');
const sendBtn            = document.getElementById('send-btn');
const connectionStatus   = document.getElementById('connection-status');
const messagesDiv        = document.getElementById('messages');
const jidInput           = document.getElementById('jid');
const passwordInput      = document.getElementById('password');
const messageInput       = document.getElementById('message-input');
const currentUserSpan    = document.getElementById('current-user');
const conversationItems  = document.getElementById('conversation-items');
const contactItems       = document.getElementById('contact-items');
const currentContactName = document.getElementById('current-contact-name');
const contactStatusEl    = document.getElementById('contact-status');

// ============================================
// STATE
// ============================================
let xmppClient          = null;
let myBareJid           = null;
let currentConversation = null;
let conversations       = new Map(); // Stocke les conversations
let contacts            = new Map(); // Stocke tous les utilisateurs
let messagesCache       = new Map(); // Cache des messages
let presenceQueue       = [];        // Présences en attente
let mamLoadedFor        = new Set(); // Historique déjà chargé

// ============================================
// CONFIGURATION
// ============================================
const SERVER_DOMAIN = '192.168.11.125';
const API_URL = `http://${SERVER_DOMAIN}:5280/api`;

// ============================================
// UTILITIES
// ============================================

function formatTime(date) {
    return new Date(date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date) {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    
    if (d.toDateString() === today.toDateString()) return formatTime(d);
    if (d.toDateString() === yesterday.toDateString()) return 'Hier';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function bareJid(fullOrBare) {
    return fullOrBare ? fullOrBare.split('/')[0] : '';
}

function localPart(jidStr) {
    return jidStr ? jidStr.split('@')[0] : jidStr;
}

// Avatar stable basé sur le nom
function getAvatarUrl(name, seed) {
    const colors = ['4CAF50','2196F3','9C27B0','FF5722','00BCD4','FF9800','E91E63','3F51B5'];
    let hash = 0;
    const str = seed || name;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const color = colors[Math.abs(hash) % colors.length];
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${color}&color=fff&size=64`;
}

// ============================================
// SCROLL MANAGEMENT - CORRIGÉ
// ============================================
function scrollToBottom(force = false) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    
    // Vérifier si l'utilisateur est déjà en bas (avec une marge de 50px)
    const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50;
    
    if (force || isScrolledToBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

// Détection du scroll manuel
let userHasScrolled = false;

function setupScrollDetection() {
    const container = document.getElementById('messages-container');
    if (!container) return;
    
    container.addEventListener('scroll', () => {
        const isAtBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50;
        userHasScrolled = !isAtBottom;
    });
}

// ============================================
// PRESENCE HELPERS
// ============================================

function getPresenceDot(presence) {
    const color = presence === 'online' ? '#4CAF50' :
                  presence === 'away' ? '#FF9800' :
                  presence === 'dnd' ? '#f44336' :
                  presence === 'xa' ? '#9C27B0' : '#9e9e9e';
    return `<i class="fas fa-circle" style="color:${color}; font-size:8px;"></i>`;
}

function getPresenceText(presence) {
    const map = { 
        online: 'En ligne', 
        away: 'Absent', 
        xa: 'Très absent', 
        dnd: 'Ne pas déranger', 
        offline: 'Hors ligne' 
    };
    return map[presence] || 'Hors ligne';
}

// ============================================
// MESSAGES MANAGEMENT - CORRIGÉ
// ============================================

function renderMessage({ from, body, outgoing, archive, timestamp }) {
    const el = document.createElement('div');
    el.className = `message ${outgoing ? 'outgoing' : 'incoming'}${archive ? ' archive' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = outgoing ? 'Moi' : localPart(from);

    const content = document.createElement('div');
    content.className = 'message-body';
    content.textContent = body;

    const timeEl = document.createElement('div');
    timeEl.className = 'time';
    timeEl.textContent = formatTime(timestamp || new Date());

    el.appendChild(meta);
    el.appendChild(content);
    el.appendChild(timeEl);
    
    messagesDiv.appendChild(el);
    
    // Scroll automatique seulement pour les messages récents (pas les archives lointaines)
    const isRecent = Math.abs(new Date() - new Date(timestamp)) < 5000; // 5 secondes
    if (isRecent || (!archive && !userHasScrolled)) {
        scrollToBottom(true);
    }
}

function clearMessages() {
    messagesDiv.innerHTML = '';
}

function cacheMessage(peerJid, msgObj) {
    if (!messagesCache.has(peerJid)) messagesCache.set(peerJid, []);
    messagesCache.get(peerJid).push(msgObj);
}

// ============================================
// CONTACTS MANAGEMENT
// ============================================

async function loadAllEjabberdUsers() {
    try {
        console.log('📋 Chargement de tous les utilisateurs ejabberd...');
        
        // Utilisateurs par défaut (fallback si API indisponible)
        let users = ['admin', 'alice', 'bob', 'soukaina'];
        
        // Essayer l'API REST ejabberd
        try {
            const response = await fetch(`${API_URL}/registered_users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host: SERVER_DOMAIN })
            });
            
            if (response.ok) {
                users = await response.json();
            }
        } catch (e) {
            console.warn('⚠️ API ejabberd indisponible, utilisation fallback');
        }
        
        // Convertir en JIDs complets et exclure soi-même
        const allJids = users
            .map(u => `${u}@${SERVER_DOMAIN}`)
            .filter(jid => jid !== myBareJid);
        
        console.log(`✅ ${allJids.length} utilisateurs trouvés`);
        
        // Ajouter tous les utilisateurs comme contacts
        contacts.clear();
        allJids.forEach(jid => {
            const name = localPart(jid);
            contacts.set(jid, {
                jid,
                name,
                presence: 'offline',
                avatar: getAvatarUrl(name, jid),
                lastSeen: null
            });
        });
        
        // Charger le roster pour les présences réelles
        try {
            await loadRoster();
        } catch (e) {
            console.warn('Roster non disponible');
        }
        
        // Appliquer les présences en attente
        presenceQueue.forEach(({ from, presence }) => {
            const contact = contacts.get(from);
            if (contact) contact.presence = presence;
        });
        presenceQueue = [];
        
        // Mettre à jour l'affichage
        renderContacts();
        renderConversations();
        
    } catch (error) {
        console.error('❌ Erreur chargement utilisateurs:', error);
        loadDefaultContacts();
    }
}

function loadDefaultContacts() {
    const defaultUsers = ['admin', 'alice', 'bob', 'soukaina'];
    
    contacts.clear();
    defaultUsers.forEach(name => {
        const jid = `${name}@${SERVER_DOMAIN}`;
        if (jid !== myBareJid) {
            contacts.set(jid, {
                jid,
                name,
                presence: 'offline',
                avatar: getAvatarUrl(name, jid),
                lastSeen: null
            });
        }
    });
    
    renderContacts();
}

function updateContactPresence(jid, presence) {
    const contact = contacts.get(jid);
    if (contact) {
        contact.presence = presence;
        contact.lastSeen = new Date();
    }
    renderContacts();
    if (currentConversation === jid) updateChatHeader(jid);
    renderConversations();
}

function renderContacts() {
    if (!contactItems) return;
    
    const sorted = Array.from(contacts.values()).sort((a, b) => {
        const order = { online: 0, away: 1, dnd: 2, xa: 3, offline: 4 };
        const pa = order[a.presence] || 4;
        const pb = order[b.presence] || 4;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
    });

    if (sorted.length === 0) {
        contactItems.innerHTML = '<div class="loading">Aucun utilisateur trouvé</div>';
        return;
    }

    contactItems.innerHTML = sorted.map(c => `
        <div class="conversation-item${currentConversation === c.jid ? ' active' : ''}" data-jid="${c.jid}">
            <div class="conversation-avatar" style="position:relative">
                <img src="${c.avatar}" alt="${c.name}">
                <span class="presence-dot ${c.presence !== 'offline' ? 'online' : 'offline'}"></span>
            </div>
            <div class="conversation-info">
                <span class="conversation-name">${c.name}</span>
                <span class="conversation-last-message" style="display:flex;align-items:center;gap:4px">
                    ${getPresenceDot(c.presence)} ${getPresenceText(c.presence)}
                </span>
            </div>
        </div>
    `).join('');

    contactItems.querySelectorAll('.conversation-item').forEach(el => {
        el.addEventListener('click', () => selectConversation(el.dataset.jid));
    });
}

// ============================================
// ROSTER MANAGEMENT
// ============================================

function loadRoster() {
    return new Promise((resolve, reject) => {
        const rqId = 'roster_' + Date.now();
        const timer = setTimeout(() => {
            xmppClient.removeListener('stanza', handler);
            reject(new Error('Roster timeout'));
        }, 6000);

        function handler(stanza) {
            if (stanza.is('iq') && stanza.attrs.id === rqId) {
                clearTimeout(timer);
                xmppClient.removeListener('stanza', handler);
                
                if (stanza.attrs.type === 'result') {
                    const query = stanza.getChild('query', 'jabber:iq:roster');
                    if (query) {
                        query.getChildren('item').forEach(item => {
                            const jid = item.attrs.jid;
                            if (!contacts.has(jid) && jid !== myBareJid) {
                                const name = item.attrs.name || localPart(jid);
                                contacts.set(jid, {
                                    jid,
                                    name,
                                    presence: 'offline',
                                    avatar: getAvatarUrl(name, jid),
                                    lastSeen: null
                                });
                            }
                        });
                    }
                    resolve();
                } else {
                    reject(new Error('Roster error'));
                }
            }
        }

        xmppClient.on('stanza', handler);
        xmppClient.send(xml('iq', { type: 'get', id: rqId },
            xml('query', { xmlns: 'jabber:iq:roster' })
        ));
    });
}

// ============================================
// CONVERSATIONS MANAGEMENT - CORRIGÉ
// ============================================

function upsertConversation(jid, lastMessage, lastTime, unreadDelta = 0) {
    const contact = contacts.get(jid);
    const name = contact?.name || localPart(jid);
    const avatar = contact?.avatar || getAvatarUrl(name, jid);
    
    const existing = conversations.get(jid);
    const newUnread = existing ? existing.unread + (unreadDelta || 0) : (unreadDelta || 0);
    
    conversations.set(jid, {
        jid,
        name,
        avatar,
        lastMessage: lastMessage !== undefined ? lastMessage : (existing?.lastMessage || ''),
        lastTime: lastTime || existing?.lastTime || new Date(),
        unread: newUnread > 0 ? newUnread : 0
    });
}

function renderConversations() {
    if (!conversationItems) return;
    
    const sorted = Array.from(conversations.values())
        .sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));

    if (sorted.length === 0) {
        conversationItems.innerHTML = '<div class="loading" style="color:rgba(255,255,255,0.5)">Aucune conversation</div>';
        return;
    }

    conversationItems.innerHTML = sorted.map(c => {
        const contact = contacts.get(c.jid);
        const presence = contact?.presence || 'offline';
        return `
        <div class="conversation-item${currentConversation === c.jid ? ' active' : ''}" data-jid="${c.jid}">
            <div class="conversation-avatar" style="position:relative">
                <img src="${c.avatar}" alt="${c.name}">
                <span class="presence-dot ${presence !== 'offline' ? 'online' : 'offline'}"></span>
            </div>
            <div class="conversation-info">
                <span class="conversation-name">${c.name}</span>
                <span class="conversation-last-message">${c.lastMessage || '...'}</span>
            </div>
            <div class="conversation-meta">
                <span class="conversation-time">${formatDate(c.lastTime)}</span>
                ${c.unread > 0 ? `<span class="unread-badge">${c.unread}</span>` : ''}
            </div>
        </div>`;
    }).join('');

    conversationItems.querySelectorAll('.conversation-item').forEach(el => {
        el.addEventListener('click', () => selectConversation(el.dataset.jid));
    });
}

// ============================================
// SELECT CONVERSATION - CORRIGÉ
// ============================================

async function selectConversation(jid) {
    if (!jid) return;
    
    currentConversation = jid;
    userHasScrolled = false; // Réinitialiser le flag de scroll
    
    // Mettre à jour les compteurs
    const conv = conversations.get(jid);
    if (conv) conv.unread = 0;
    
    // Mettre à jour l'UI
    updateChatHeader(jid);
    renderConversations();
    renderContacts();
    
    // Afficher les messages
    clearMessages();
    
    // Indicateur de chargement
    const loadingEl = document.createElement('div');
    loadingEl.id = 'msg-loading';
    loadingEl.className = 'message incoming archive';
    loadingEl.innerHTML = '<div class="message-body">⏳ Chargement de l\'historique...</div>';
    messagesDiv.appendChild(loadingEl);
    
    // Charger l'historique si pas déjà fait
    if (!mamLoadedFor.has(jid)) {
        try {
            await loadChatHistory(jid, 100);
            mamLoadedFor.add(jid);
        } catch (error) {
            console.warn('⚠️ MAM indisponible:', error.message);
        }
    }
    
    loadingEl.remove();
    
    // Afficher les messages en cache (triés par date)
    const cached = (messagesCache.get(jid) || [])
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    if (cached.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'empty-conv';
        emptyEl.textContent = 'Aucun message. Commencez la conversation !';
        messagesDiv.appendChild(emptyEl);
    } else {
        cached.forEach(msg => renderMessage(msg));
    }
    
    // Scroll vers le bas après chargement
    setTimeout(() => scrollToBottom(true), 100);
}

function updateChatHeader(jid) {
    const contact = contacts.get(jid);
    if (!contact) return;
    
    currentContactName.textContent = contact.name;
    contactStatusEl.innerHTML = `${getPresenceDot(contact.presence)} ${getPresenceText(contact.presence)}`;
    
    const headerAvatar = document.querySelector('.contact-avatar img');
    if (headerAvatar) headerAvatar.src = contact.avatar;
}

// ============================================
// MESSAGE ARCHIVE MANAGEMENT (MAM)
// ============================================

async function loadChatHistory(withUser, limit = 50) {
    return new Promise((resolve, reject) => {
        if (!xmppClient) return reject(new Error('Non connecté'));

        const queryId = 'mam_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

        const queryEl = xml('query', { xmlns: 'urn:xmpp:mam:2', queryid: queryId });
        const xEl = xml('x', { xmlns: 'jabber:x:data', type: 'submit' });
        xEl.append(xml('field', { var: 'FORM_TYPE' }, xml('value', {}, 'urn:xmpp:mam:2')));
        xEl.append(xml('field', { var: 'with' }, xml('value', {}, withUser)));
        queryEl.append(xEl);

        const setEl = xml('set', { xmlns: 'http://jabber.org/protocol/rsm' });
        setEl.append(xml('max', {}, String(limit)));
        setEl.append(xml('before', {}));
        queryEl.append(setEl);

        const iqStanza = xml('iq', { type: 'set', id: queryId }, queryEl);

        const timer = setTimeout(() => {
            xmppClient.removeListener('stanza', handler);
            resolve();
        }, 8000);

        function handler(stanza) {
            if (stanza.is('iq') && stanza.attrs.id === queryId) {
                clearTimeout(timer);
                xmppClient.removeListener('stanza', handler);
                stanza.attrs.type === 'result' ? resolve() : reject(new Error('MAM error'));
            }
        }

        xmppClient.on('stanza', handler);
        xmppClient.send(iqStanza);
    });
}

// ============================================
// SEND MESSAGE - CORRIGÉ
// ============================================

async function sendMessage() {
    if (!currentConversation) {
        alert('Sélectionnez une conversation');
        return;
    }
    
    const text = messageInput.value.trim();
    if (!text) return;

    try {
        const msgId = 'msg_' + Date.now();
        await xmppClient.send(xml('message',
            { to: currentConversation, type: 'chat', id: msgId },
            xml('body', {}, text)
        ));

        const msgObj = { 
            from: myBareJid, 
            body: text, 
            outgoing: true, 
            archive: false, 
            timestamp: new Date() 
        };
        
        cacheMessage(currentConversation, msgObj);
        renderMessage(msgObj);
        
        // Mettre à jour la conversation avec le dernier message
        upsertConversation(currentConversation, text, new Date(), 0);
        
        // Forcer la mise à jour immédiate
        const conv = conversations.get(currentConversation);
        if (conv) {
            conv.lastMessage = text;
            conv.lastTime = new Date();
        }
        
        renderConversations();
        messageInput.value = '';
        
        // Reset du flag de scroll pour le nouveau message
        userHasScrolled = false;
        
    } catch (err) {
        console.error('❌ Erreur envoi:', err);
        alert('Erreur envoi: ' + err.message);
    }
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') sendMessage();
});

// ============================================
// STANZA HANDLER - CORRIGÉ
// ============================================

function handleStanza(stanza) {
    
    // ---- MESSAGES ----
    if (stanza.is('message')) {
        const from = bareJid(stanza.attrs.from || '');
        const type = stanza.attrs.type;
        
        // Message d'archive MAM
        const result = stanza.getChild('result', 'urn:xmpp:mam:2');
        if (result) {
            handleMAMMessage(result, from);
            return;
        }
        
        // Message normal
        const body = stanza.getChildText('body');
        if (!body || type === 'error' || !from || from === myBareJid) return;
        
        // Éviter les doublons
        const cached = messagesCache.get(from) || [];
        if (cached.some(m => m.body === body && !m.outgoing &&
            Math.abs(new Date(m.timestamp) - Date.now()) < 3000)) return;
        
        const msgObj = { 
            from, 
            body, 
            outgoing: false, 
            archive: false, 
            timestamp: new Date() 
        };
        
        cacheMessage(from, msgObj);
        
        // S'assurer que le contact existe
        if (!contacts.has(from)) {
            const name = localPart(from);
            contacts.set(from, {
                jid: from,
                name,
                presence: 'online',
                avatar: getAvatarUrl(name, from),
                lastSeen: new Date()
            });
        }
        
        const isActive = currentConversation === from;
        
        // Mettre à jour la conversation avec le dernier message
        upsertConversation(from, body, new Date(), isActive ? 0 : 1);
        
        // Forcer la mise à jour immédiate de la conversation
        const conv = conversations.get(from);
        if (conv) {
            conv.lastMessage = body;
            conv.lastTime = new Date();
        }
        
        renderConversations();
        
        if (isActive) {
            renderMessage(msgObj);
        } else {
            notifyNewMessage(from);
        }
    }
    
    // ---- PRESENCE ----
    if (stanza.is('presence')) {
        const from = bareJid(stanza.attrs.from || '');
        const type = stanza.attrs.type || 'available';
        const show = stanza.getChildText('show') || '';
        
        if (!from || from === myBareJid) return;
        
        if (type === 'subscribe') {
            // Accepter automatiquement
            xmppClient.send(xml('presence', { to: from, type: 'subscribed' }));
            xmppClient.send(xml('presence', { to: from, type: 'subscribe' }));
            return;
        }
        
        let presence = 'offline';
        if (type === 'available') {
            presence = show || 'online';
        }
        
        if (contacts.has(from)) {
            updateContactPresence(from, presence);
        } else {
            presenceQueue.push({ from, presence });
        }
    }
    
    // ---- ROSTER UPDATES ----
    if (stanza.is('iq') && stanza.attrs.type === 'set') {
        const query = stanza.getChild('query', 'jabber:iq:roster');
        if (query) {
            query.getChildren('item').forEach(item => {
                const jid = item.attrs.jid;
                if (item.attrs.subscription === 'remove') {
                    contacts.delete(jid);
                } else if (!contacts.has(jid) && jid !== myBareJid) {
                    const name = item.attrs.name || localPart(jid);
                    contacts.set(jid, {
                        jid,
                        name,
                        presence: 'offline',
                        avatar: getAvatarUrl(name, jid),
                        lastSeen: null
                    });
                }
            });
            renderContacts();
            xmppClient.send(xml('iq', { type: 'result', id: stanza.attrs.id }));
        }
    }
}

function handleMAMMessage(result, from) {
    const forwarded = result.getChild('forwarded', 'urn:xmpp:forward:0');
    if (!forwarded) return;
    
    const innerMsg = forwarded.getChild('message');
    if (!innerMsg) return;
    
    const body = innerMsg.getChildText('body');
    if (!body) return;
    
    const delay = forwarded.getChild('delay', 'urn:xmpp:delay');
    const timestamp = delay ? new Date(delay.attrs.stamp) : new Date();
    const msgFrom = bareJid(innerMsg.attrs.from || '');
    const msgTo = bareJid(innerMsg.attrs.to || '');
    const outgoing = msgFrom === myBareJid;
    const peer = outgoing ? msgTo : msgFrom;
    
    if (!peer || peer === myBareJid) return;
    
    // Éviter les doublons
    const cached = messagesCache.get(peer) || [];
    if (cached.some(m => m.body === body && m.outgoing === outgoing &&
        Math.abs(new Date(m.timestamp) - timestamp) < 2000)) return;
    
    const msgObj = { from: msgFrom, body, outgoing, archive: true, timestamp };
    cacheMessage(peer, msgObj);
    
    // Créer ou mettre à jour la conversation
    upsertConversation(peer, body, timestamp, 0);
    
    // Forcer la mise à jour du dernier message
    const conv = conversations.get(peer);
    if (conv) {
        conv.lastMessage = body;
        conv.lastTime = timestamp;
    }
    
    renderConversations();
    
    if (currentConversation === peer) renderMessage(msgObj);
}

function notifyNewMessage(fromJid) {
    // Changer le titre de l'onglet
    const original = document.title;
    let flashing = true;
    const interval = setInterval(() => {
        document.title = flashing ? '💬 Nouveau message !' : original;
        flashing = !flashing;
    }, 800);
    
    window.addEventListener('focus', () => { 
        clearInterval(interval); 
        document.title = original; 
    }, { once: true });
}

// ============================================
// ADD CONTACT BUTTON
// ============================================

document.querySelector('.btn-add-contact')?.addEventListener('click', () => {
    if (!xmppClient) return alert('Non connecté');
    
    const jidStr = prompt('JID du contact (ex: nom@192.168.11.125)');
    if (!jidStr || !jidStr.includes('@')) return;
    
    xmppClient.send(xml('presence', { to: jidStr, type: 'subscribe' }));
    
    const name = localPart(jidStr);
    contacts.set(jidStr, {
        jid: jidStr,
        name,
        presence: 'offline',
        avatar: getAvatarUrl(name, jidStr),
        lastSeen: null
    });
    
    renderContacts();
    alert(`Demande d'abonnement envoyée à ${name}`);
});

// ============================================
// SEARCH FILTER
// ============================================

document.querySelectorAll('.search-input').forEach(input => {
    input.addEventListener('input', () => {
        const q = input.value.toLowerCase();
        const list = input.closest('.conversations-list, .contacts-list');
        if (!list) return;
        
        list.querySelectorAll('.conversation-item').forEach(el => {
            const name = el.querySelector('.conversation-name')?.textContent.toLowerCase() || '';
            el.style.display = name.includes(q) ? '' : 'none';
        });
    });
});

// ============================================
// TAB MANAGEMENT
// ============================================

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const tab = btn.dataset.tab;
        document.querySelectorAll('.conversations-list, .contacts-list').forEach(el => {
            el.classList.remove('active');
        });
        document.getElementById(`${tab}-list`).classList.add('active');
    });
});

// ============================================
// CONNECTION
// ============================================

connectBtn.addEventListener('click', async () => {
    const fullJid = jidInput.value.trim();
    const password = passwordInput.value.trim();
    
    if (!fullJid || !password) {
        alert('Veuillez remplir tous les champs');
        return;
    }

    connectionStatus.textContent = 'Connexion en cours...';
    connectionStatus.style.color = '#4CAF50';
    connectBtn.disabled = true;

    try {
        const jidParts = jid(fullJid);
        myBareJid = `${jidParts.local}@${jidParts.domain}`;

        xmppClient = client({
            service: 'ws://localhost:5443/ws',
            domain: jidParts.domain,
            resource: 'web-client',
            username: jidParts.local,
            password: password,
            mechanisms: ['PLAIN', 'SCRAM-SHA-1']
        });

        xmppClient.reconnect.stop();

        xmppClient.on('status', (status) => {
            console.log('Status:', status);
            connectionStatus.textContent = `Status: ${status}`;
        });

        xmppClient.on('error', async (err) => {
            console.error('❌ Erreur:', err);
            connectionStatus.textContent = `Erreur: ${err.message}`;
            connectionStatus.style.color = '#f44336';
            
            try { await xmppClient.stop(); } catch(e) {}
            connectBtn.disabled = false;
        });

        xmppClient.on('online', async (address) => {
            myBareJid = bareJid(address.toString());
            console.log('✅ Connecté en tant que:', myBareJid);
            
            loginScreen.classList.add('hidden');
            mainInterface.classList.remove('hidden');
            currentUserSpan.textContent = localPart(myBareJid);
            
            const avatarImg = document.querySelector('.user-profile .avatar img');
            if (avatarImg) {
                avatarImg.src = getAvatarUrl(localPart(myBareJid), myBareJid);
            }
            
            await xmppClient.send(xml('presence'));
            
            xmppClient.send(xml('iq', { type: 'set', id: 'carbons1' },
                xml('enable', { xmlns: 'urn:xmpp:carbons:2' })
            ));
            
            // Configurer la détection de scroll
            setupScrollDetection();
            
            // Charger tous les utilisateurs
            await loadAllEjabberdUsers();
        });

        xmppClient.on('offline', () => {
            console.log('🔌 Déconnecté');
            loginScreen.classList.remove('hidden');
            mainInterface.classList.add('hidden');
            connectBtn.disabled = false;
            
            conversations.clear();
            contacts.clear();
            messagesCache.clear();
            mamLoadedFor.clear();
            presenceQueue = [];
            currentConversation = null;
        });

        xmppClient.on('stanza', handleStanza);
        
        await xmppClient.start();

    } catch (err) {
        console.error('💥 Erreur fatale:', err);
        connectionStatus.textContent = `Erreur: ${err.message}`;
        connectionStatus.style.color = '#f44336';
        connectBtn.disabled = false;
        
        if (xmppClient) {
            try { await xmppClient.stop(); } catch(e) {}
        }
    }
});

// ============================================
// LOGOUT
// ============================================

logoutBtn.addEventListener('click', async () => {
    if (xmppClient) {
        try {
            await xmppClient.send(xml('presence', { type: 'unavailable' }));
            await xmppClient.stop();
        } catch(e) {}
    }
    
    conversations.clear();
    contacts.clear();
    messagesCache.clear();
    mamLoadedFor.clear();
    presenceQueue = [];
    currentConversation = null;
    connectBtn.disabled = false;
});

// Rendre selectConversation accessible globalement
window.selectConversation = selectConversation;