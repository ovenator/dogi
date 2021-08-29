# Dogi

Dogi allows you to do `docker build && docker run` on your git repo by http call like this 
`https://dogi.ove.me/https/github.com/ovenator-scrapy-demo.git?action=run&bashc=pipenv run scrapy`

[comment]: <> (## Demo)

[comment]: <> (The following will checkout the repository, build the Dockerfile, run the command and stream the selected file to you in real time. Optional signature prevents clients from tampering the parameters)

[comment]: <> (#### Get scraped data)

[comment]: <> (https://dogi.ove.me/https/github.com/ovenator/dogi-scrapy-demo.git?id=all_pages&action=run&output=file_data&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy&sig=cab976410e8cb7b2dd85eee67c43d17e6d314c0e)

[comment]: <> (#### Get logs)

[comment]: <> (https://dogi.ove.me/https/github.com/ovenator/dogi-scrapy-demo.git?id=all_pages&action=run&output=log&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy&sig=fc18f584ca659bdff8033111677365e8c23d8b34)

[comment]: <> (#### Get HTTP status and links to output files)

[comment]: <> (https://dogi.ove.me/https/github.com/ovenator/dogi-scrapy-demo.git?id=all_pages&action=run&output=status&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy&sig=3d72af23cee53efe1ba4bd60e48fd2e8858e1bd0)

[comment]: <> (#### Pass ENV variables)

[comment]: <> (Note that if you want to run multiple instances in parallel, you have to supply an id param. If you call `action=run` multiple times on the same id, it will just attach to the previous run, not taking into account the changes in parameters. If you want to change the parameters, use `action=restart`)

[comment]: <> (https://dogi.ove.me/https/github.com/ovenator/dogi-scrapy-demo.git?id=max_pages&action=run&output=file_data&file_data=/app/data.jsonl&bashc=pipenv%20run%20scrapy&env_MAX_PAGES=1&sig=e5e4bb1389606c772e5f1cd760a8574ebadb0e05)



## Installation
```shell
 docker run -ti 
 -p 3001:3001 \
 -v /tmp:/tmp \
 -v ~/.ssh/id_rsa:/root/.ssh/id_rsa:ro \
 -v /var/run/docker.sock:/var/run/docker.sock \
 -e BYPASS_SIGNATURES=true --rm ovenator/dogi:latest
```

* `-v ~/.ssh/id_rsa:/root/.ssh/id_rsa:ro` - link your private ssh key for access to private repositories
* `-v /tmp:/tmp` - required for handing over the files from inside of the container, if you change this to `-v /foo:/tmp`, you will have to set `HOST_SHARED_DIR=/foo`


### Container ENV params

| Name                      | Default value  | Description   |
| :------------------------ | :------------- | :------------ |
| BYPASS_SIGNATURES         |   **false**    |  If set to true, the 'sig' query param will not be required |
| SIGNATURES_SECRET         |                |  Secret used to sign the url `sha1(secret:/https/mygitrepo?foo=bar)` |
| ADVERTISED_URL            |                |  Base url used in callbacks to reference the the dogi host for downloading output files |
| HOST_SHARED_DIR           |    **/tmp**    | The directory on host machine to be used to store files, should be readable and writable by any user  |
| CB_HEADERS                |    **{}**      | JSON with headers to be passed to the callback. Ex. `{"Authorization": "Bearer <token>"}`  |
| NAMESPACE                 |    **default** | When running multiple instances of Dogi on single host, this is used to avoid container and file name collisions |


## GET/POST /:protocol/:repo
### Path Params

#### protocol
* **ssh**
* **http**
* **https**

#### repo
Examples:
* `/https/github.com/ovenator/dogi-scrapy-demo.git`
* `/ssh/git@github.com:ovenator/dogi-scrapy-demo.git`

### Params
Params can be provided as GET query params or POST json body params

#### action
* **peek** *(default)* - just attach to the running task or show result of finished task, idempotent
* **run** - build and run the container, if instance with same identifier is already running, this will act as `peek`. If you want to change parameters of running task use `restart`
* **abort** - force remove the container
* **restart** - subsequent abort and restart, or run when not running

#### attach
If set to **true**, closing the http connection will act as `abort` request


#### cmd
Will be passed as cmd command to the container split by spaces. Ex. `cmd=node run start` will be passed to the container as `CMD [node, run, start]`

#### bashc
Alias for `CMD [bash, -c, command]`. Ex. `?bashc=command`

#### id
Instance id, allows you to run multiple instances of the same repository.

#### output
 * **log** *(default)* - combined docker build, run and other logs related to exectuion
 * **status** - json containing information about task
 * **file_*** - file inside container to be used as output, defined as below

#### file_{id}
Arbitrary file path inside container. Id is arbitrary identifier Ex. `file_data=/app/data.json`

#### env_{param}
Arbitrary env param, will be passed to the container run command. Ex. `env_LOG_LEVEL=debug`

#### output_type
 * **stream** *(default)* - selected output will be tail-ed to the http response
 * **wait** - hangs until the process is finished, then shows the result. Response status will reflect the result (200 or 500)
 * **async** - shows output that is currently available, not waiting

#### cb
When execution is finished, this url will be POST called with json payload similar to 'status' output. If the callback returns and error, the entire task will behave as failed

#### sig
Optional url signature to prevent url tampering. Only required when `BYPASS_SIGNATURES` is not set, must be the last param

## GET /collect
Returns output from all instances and repos with given name joined together, can be useful for aggregate view of error logs
### Query params

#### output
Name of output to be collected. Ex. `output=file_errors`
