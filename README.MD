# Dogi

[comment]: <> (Execute code in any GIT repo via HTTP)
Turn any GIT repository into HTTP callable endpoint

### Example
https://dogi.run/ssh/git@github.com/ovenator/scrapy-amazon.git

http://localhost:3001/ssh/git@github.com:ovenator/estates.git?output=log&file=/app/data.jsonl&bashc=pipenv run scrapy
http://localhost:3001/ssh/git@github.com:ovenator/estates.git?action=peek&output=runLog
http://localhost:3001/ssh/git@github.com:ovenator/estates.git?action=peek&output=file


### Installation
```shell
 docker run -ti -p 3001:3001 -v /tmp:/tmp -v ~/.ssh/id_rsa:/root/.ssh/id_rsa:ro -v /var/run/docker.sock:/var/run/docker.sock -e BYPASS_SIGNATURES=true --rm dogi-test 
```
### Query Params

| Param         | Default           |
| ------------- |:-------------| 
| df            | Dockerfile |
| cmd           |       | 
| sig          |      |   
| attach          |  build-log    |   
| he          | localhost:80|
| hm          | GET|??

### Ouputs
build-log
http
data-stream
run-log