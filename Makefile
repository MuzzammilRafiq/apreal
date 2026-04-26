deploy-relay:
	bun run build:relay
	scp ./apps/relay-server/dist/* root@168.144.27.12:/root/relay/src/
	ssh root@168.144.27.12 "cd /root/relay && npm install && npm run start"

run-web:
	bun run dev:web

run-server:
	bun run dev:server

run:
	bun run dev