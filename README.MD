# Dogi


[comment]: <> (https://dogi.run/ssh/git@github.com/ovenator/scrapy-amazon.git)

[comment]: <> (http://localhost:3001/ssh/git@github.com:ovenator/estates.git?output=log&file=/app/data.jsonl&bashc=pipenv run scrapy)

[comment]: <> (http://localhost:3001/ssh/git@github.com:ovenator/estates.git?action=peek&output=runLog)

[comment]: <> (http://localhost:3001/ssh/git@github.com:ovenator/estates.git?action=peek&output=file)

[comment]: <> (https://dogi.x.cap01.svcs.kolem.cz/https/github.com/ovenator/estates.git?output=log&action=run&file_1=/app/data.jsonl&bashc=pipenv%20run%20scrapy)

[comment]: <> (https://dogi.x.cap01.svcs.kolem.cz/https/github.com/ovenator/estates.git?output=file_1)
[comment]: <> (https://dogi.ove.me/https/github.com/ovenator/estates.git?output=file_1)

### Installation
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


### Query params

| Name                      | Default value  | Description   |
| :------------------------ | :------------- | :------------ |
|   sig                     |                | Must the the last param. Required unless the BYPASS_SIGNATURES env var is set to true. |
|   output                  |   log          | The selected will be tailed to the http reponse. <br/> file_* - tail the selected file inside container Ex. `output=file_myFile` <br/> log - tail the container build and run logs subsequently <br/> status - will hang until the task is finished, then returns 200 or 500 depending if the task succeeded, response will contain links to download output files  |
|   action                  |   peek         | run - run the task, response will be tail of the selected output <br/> peek - just tail the selected output <br/> restart - abort and run subsequently <br/> abort - kill the task |
|   file_*                  |                | Reference file inside container. Ex: `?file_myFile=/app/myFile.json`   |
|   env_*                   |                | Pass environment variable to container. Ex: `?env_FOO=bar` will run container with `FOO` env variable |
|   id                      |                | To be able to reference multiple concurrent runs based on the same git repo |
|   cb                      |                | When execution is finished, this url will be POST called with json payload similar to 'status' output. If the callback returns and error, the entire task will behave as failed |
|   cmd                     |                | Will be passed as cmd command to the container split by spaces. Ex. `?cmd=node run start` will be passed to the container as `CMD [node, run, start`]`  |
|   bashc                   |                | Alias for `CMD [bash, -c, command]`. Ex. `?bashc=command`  |
