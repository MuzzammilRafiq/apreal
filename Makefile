deploy-relay:
	@echo "Deploying relay to remote server..."
	bun run build:relay
	scp ./apps/relay-server/dist/* root@168.144.27.12:/root/relay/src/
	@echo "Relay deployment complete."
	ssh root@168.144.27.12 "cd /root/relay && npm install && npm run start"
