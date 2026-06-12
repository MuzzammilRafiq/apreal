web:
	pnpm run dev:web:local

server:
	pnpm run build:web
	APREAL_ALLOW_PRIVATE_NETWORK_ADMIN=true pnpm run dev:server

dr:
	scp ./apps/relay-server/dist/package.json root@168.144.27.12:/root/relay/package.json && \
	scp -r ./apps/relay-server/dist/src/* root@168.144.27.12:/root/relay/src/ && \
	ssh root@168.144.27.12
	
