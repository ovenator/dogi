# Dogi


[comment]: <> (https://dogi.run/ssh/git@github.com/ovenator/scrapy-amazon.git)

[comment]: <> (http://localhost:3001/ssh/git@github.com:ovenator/estates.git?output=log&file=/app/data.jsonl&bashc=pipenv run scrapy)

[comment]: <> (http://localhost:3001/ssh/git@github.com:ovenator/estates.git?action=peek&output=runLog)

[comment]: <> (http://localhost:3001/ssh/git@github.com:ovenator/estates.git?action=peek&output=file)


### Installation
```shell
 docker run -ti 
 -p 3001:3001 \
 -v /tmp:/tmp \
 -v ~/.ssh/id_rsa:/root/.ssh/id_rsa:ro \
 -v /var/run/docker.sock:/var/run/docker.sock \
 -e BYPASS_SIGNATURES=true --rm ovenator/dogi:latest
```
