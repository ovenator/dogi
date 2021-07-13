FROM node:14-alpine

RUN apk add --no-cache --update git openssh
COPY docker/.ssh /root/.ssh
RUN chmod 400 /root/.ssh/config
RUN apk add --update nmap-ncat openssh-server
#https://dogi.x.cap01.svcs.kolem.cz/https/github.com/ovenator/estates.git?output=log&action=run&file_1=/app/data.jsonl&bashc=pipenv%20run%20scrapy

COPY . /app
WORKDIR /app
RUN yarn install

CMD npm start