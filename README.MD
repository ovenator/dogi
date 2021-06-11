# Dogi

[comment]: <> (Execute code in any GIT repo via HTTP)
Turn any GIT repository into HTTP callable endpoint

### Example
https://dogi.run/ssh/git@github.com/ovenator/scrapy-amazon.git

`http://localhost:3001/ssh/git@github.com:ovenator/estates.git?action=peek&output=file&file=/app/data.jsonl&cmd=pipenv run scrapy`

### Installation
```shell
docker run -p 80:80 -d ovenator/dogi
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