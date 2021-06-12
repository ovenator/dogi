FROM node:14-alpine

RUN apk add --no-cache --update git openssh
COPY docker/.ssh /root/.ssh
RUN chmod 400 /root/.ssh/config

COPY . /app
WORKDIR /app
RUN yarn install

CMD npm start