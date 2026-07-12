web:
	pnpm run dev:web:local

server:
	pnpm run build:web
	APREAL_ALLOW_PRIVATE_NETWORK_ADMIN=true pnpm run dev:server

dr:
	gh workflow run deploy-relay.yml
	@echo "Relay deployment requested. Follow it with: gh run watch"
	
