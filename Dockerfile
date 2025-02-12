FROM node:18

WORKDIR /github/workspace

COPY package*.json ./

RUN npm install

COPY src ./

CMD [ "node", "index.js" ]
