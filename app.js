const { client, xml, jid } = window.XMPP;

const loginSection = document.getElementById('login-section');
const chatSection = document.getElementById('chat-section');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const sendBtn = document.getElementById('send-btn');
const connectionStatus = document.getElementById('connection-status');
const messagesDiv = document.getElementById('messages');
const jidInput = document.getElementById('jid');
const passwordInput = document.getElementById('password');
const recipientInput = document.getElementById('recipient');
const messageInput = document.getElementById('message-input');

let xmppClient = null;

function addMessage(from, body, isOutgoing = false) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
    
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = from;
    
    const content = document.createElement('div');
    content.textContent = body;
    
    messageElement.appendChild(meta);
    messageElement.appendChild(content);
    
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateStatus(status, isError = false) {
    connectionStatus.textContent = status;
    connectionStatus.style.borderLeftColor = isError ? '#dc3545' : '#4CAF50';
}

connectBtn.addEventListener('click', async () => {
    const fullJid = jidInput.value.trim();
    const password = passwordInput.value.trim();
    
    if (!fullJid || !password) {
        alert('Veuillez remplir tous les champs');
        return;
    }
    
    try {
        updateStatus('Connexion en cours...');
        
        const jidParts = jid(fullJid);
        console.log('Tentative de connexion avec:', {
            username: jidParts.local,
            domain: jidParts.domain,
            password: '***'
        });
        
        xmppClient = client({
            service: 'ws://localhost:5443/ws', 
            domain: jidParts.domain,                  
            resource: 'web-client',
            username: jidParts.local,                  
            password: password
        });
        
        xmppClient.on('status', (status) => {
            console.log('Status:', status);
            updateStatus(`Status: ${status}`);
        });
        
        xmppClient.on('error', (err) => {
            console.error('Erreur:', err);
            updateStatus(`Erreur: ${err.message}`, true);
        });
        
        xmppClient.on('online', async (address) => {
            console.log('Connecté en tant que:', address.toString());
            updateStatus(`Connecté en tant que ${address.toString()}`);
            
            await xmppClient.send(xml('presence'));
            
            loginSection.classList.add('hidden');
            chatSection.classList.remove('hidden');
            
            addMessage('Système', 'Connecté avec succès!', false);
        });
        
        xmppClient.on('offline', () => {
            console.log('Déconnecté');
            updateStatus('Déconnecté');
            loginSection.classList.remove('hidden');
            chatSection.classList.add('hidden');
        });
        
        xmppClient.on('stanza', (stanza) => {
            if (stanza.is('message')) {
                const body = stanza.getChildText('body');
                const from = stanza.attrs.from;
                
                if (body) {
                    console.log(`Message reçu de ${from}: ${body}`);
                    addMessage(from, body, false);
                }
            }
        });
        
        await xmppClient.start();
        
    } catch (error) {
        console.error('Erreur de connexion:', error);
        updateStatus(`Erreur: ${error.message}`, true);
    }
});

disconnectBtn.addEventListener('click', async () => {
    if (xmppClient) {
        try {
            await xmppClient.stop();
        } catch (error) {
            console.error('Erreur lors de la déconnexion:', error);
        }
    }
});

sendBtn.addEventListener('click', async () => {
    const recipient = recipientInput.value.trim();
    const messageText = messageInput.value.trim();
    
    if (!recipient || !messageText) {
        alert('Veuillez saisir un destinataire et un message');
        return;
    }
    
    if (!xmppClient) {
        alert('Vous n\'êtes pas connecté');
        return;
    }
    
    try {
        let fullRecipient = recipient;
        if (!recipient.includes('@')) {
            fullRecipient = `${recipient}@192.168.11.125`;  
        }
        
        const message = xml(
            'message',
            { 
                to: fullRecipient, 
                type: 'chat' 
            },
            xml('body', {}, messageText)
        );
        
        await xmppClient.send(message);
        
        addMessage(`Moi -> ${fullRecipient}`, messageText, true);
        
        messageInput.value = '';
        
    } catch (error) {
        console.error('Erreur envoi:', error);
        alert(`Erreur envoi: ${error.message}`);
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendBtn.click();
    }
});