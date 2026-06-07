deploy-relay:
	pnpm run build:relay
	scp ./apps/relay-server/dist/package.json root@168.144.27.12:/root/relay/package.json
	scp -r ./apps/relay-server/dist/src/* root@168.144.27.12:/root/relay/src/
	ssh root@168.144.27.12 "set -e; \
		pkill -f 'node ./src/index.js' || true; \
		cd /root/relay; \
		rm -rf node_modules package-lock.json; \
		npm install --omit=dev; \
		nohup npm run start > /root/relay/relay.log 2>&1 < /dev/null &"

web:
	pnpm run dev:web:local

server:
	pnpm run build:web
	APREAL_ALLOW_PRIVATE_NETWORK_ADMIN=true pnpm run dev:server

run:
	pnpm run dev
