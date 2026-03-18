# test_xmpp_final.py
import asyncio
import websockets
import sys

async def test_xmpp_direct():
    uri = "ws://192.168.11.125:5443/ws"
    print(f"🔵 Connexion à {uri}...")
    
    try:
        # Connexion WebSocket
        async with websockets.connect(uri, subprotocols=['xmpp']) as websocket:
            print("✅ WebSocket connecté!")
            
            # Envoyer l'ouverture du flux XMPP
            open_stream = '<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="192.168.11.125" version="1.0" />'
            print(f"📤 Envoi: {open_stream}")
            await websocket.send(open_stream)
            
            # Recevoir la réponse
            response = await asyncio.wait_for(websocket.recv(), timeout=5)
            print(f"📩 Réponse reçue: {response}")
            
            if '<open' in response and 'xmlns' in response:
                print("\n✅ SUCCÈS! Le serveur XMPP répond correctement!")
                return True
            else:
                print("\n⚠️ Réponse inattendue")
                return False
                
    except websockets.exceptions.WebSocketException as e:
        print(f"❌ Erreur WebSocket: {e}")
        return False

if __name__ == "__main__":
    result = asyncio.run(test_xmpp_direct())
    if result:
        print("\n🎉 Félicitations! Votre serveur XMPP est prêt!")
        print("Vous pouvez maintenant utiliser l'URL: ws://192.168.11.125:5443/ws dans xmpp.js")