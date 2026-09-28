FROM node:20

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --no-audit --no-fund

COPY . .

# 기본 포트(로컬): 7773
# Render 같은 PaaS에서는 HTTP_PORT_NO 를 PORT와 맞춰주면 됨.
EXPOSE 7773

CMD ["npm", "start"]
