deploy-relay:
	bun run build:relay
	scp ./apps/relay-server/dist/* root@168.144.27.12:/root/relay/src/
	ssh root@168.144.27.12 "set -e; \
		pkill -f 'node ./src/index.js' || true; \
		cd /root/relay; \
		npm install; \
		nohup npm run start > /root/relay/relay.log 2>&1 < /dev/null &"

web:
	bun run dev:web

server:
	bun run dev:server

run:
	bun run dev