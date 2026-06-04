deploy-relay:
	pnpm run build:relay
	scp ./apps/relay-server/dist/* root@168.144.27.12:/root/relay/src/
	ssh root@168.144.27.12 "set -e; \
		pkill -f 'node ./src/index.js' || true; \
		cd /root/relay; \
		npm install; \
		nohup npm run start > /root/relay/relay.log 2>&1 < /dev/null &"

web:
	pnpm run dev:web

server:
	pnpm run build:web
	APREAL_ALLOW_PRIVATE_NETWORK_ADMIN=true pnpm run dev:server

run:
	pnpm run dev

mobile:
	pnpm run start:mobile
