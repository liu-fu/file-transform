import React,{Component} from 'react';
import * as Status from './status';
import './fileTrans.css';

const SliceSize = 1024*1024;

class FileTrans extends Component{
    constructor(props){
        super();
        this.state = {
            files:[],
            status:Status.INIT,
            fileStatus:[],
            fileToUpload: 0,
        }
        this.addFile = this.addFile.bind(this);
        this.uploadAll = this.uploadAll.bind(this);
        this.uploadOne = this.uploadOne.bind(this);
        this.pauseOrContinue = this.pauseOrContinue.bind(this);
        this.cancel = this.cancel.bind(this);
        this.divideAndUploadSlice = this.divideAndUploadSlice.bind(this);
        this.uploadFinish = this.uploadFinish.bind(this);
        this.render = this.render.bind(this);
    }

    //监听input的change事件，添加文件时加入state.files
    addFile(event){
        const f = event.target.files;
        let tmp = [...this.state.files];
        let tmpStatus = [...this.state.fileStatus];
        
        for(let i = 0;i < f.length;++i){
            tmp.push(f[i]);
            tmpStatus.push({status:Status.fileStatus.BEFORE_UPLOAD,percentage:0});
        }
        this.setState({
            ...this.state,
            files:[...tmp],
            fileStatus:[...tmpStatus],
            fileToUpload:this.state.fileToUpload+tmp.length,
        })
        event.target.value = '';    //clear input so that change event will be caught when choose two same files
    }
    
    //上传文件，state.status状态置为uploading，
    //用promise.all等待所有文件上传完成后输出成功/失败信息
    async uploadAll(){
        const _this = this;
        await new Promise((resolve)=>{
            this.setState({...this.state,status:Status.UPLOADING},()=>{
                resolve();
            });
        })

        await Promise.all(_this.state.files.map((f,i)=>{
            return _this.uploadOne(f,i);
        }));
        if(this.state.fileToUpload>0){
            if(this.state.status==Status.PAUSING){
                return;
            }
            this.setState({...this.state,status:Status.ERROR});
        }
        else{
            this.setState({...this.state,status:Status.SUCCESS,files:[],fileStatus:[]});
            setTimeout(()=>{
                _this.setState({..._this.state,status:Status.INIT});
            },3000);
        }
    }

    //负责上传文件列表中的一个文件，返回promise
    uploadOne(file,index){
        const _this = this;
        
        return new Promise((resolve)=>{
            const url = '/upload';
            //上传失败
            var setFileError = ()=>{
                let tmpFileStatus = [..._this.state.fileStatus];
                tmpFileStatus[index].status = Status.fileStatus.ERROR;
                _this.setState({..._this.state,fileStatus:[...tmpFileStatus]},()=>{resolve('err');});
                
            }
            //上传成功
            var setFileSucc = ()=>{
                let tmpFileStatus = [..._this.state.fileStatus];
                tmpFileStatus[index].status = Status.fileStatus.SUCCESS;
                _this.setState({..._this.state,fileStatus:[...tmpFileStatus],fileToUpload:_this.state.fileToUpload-1},()=>{resolve('ok');});
            }
            //改变文件状态     
            var setFileStatus = (status)=>{
                let tmpFileStatus = [..._this.state.fileStatus];
                tmpFileStatus[index].status = status;
                _this.setState({..._this.state,fileStatus:[...tmpFileStatus]});
            }

            //filereader的onload函数，完成readfile后进行hash和上传
            const onload = function(event){    
                //用专用webworker做hash工作
                const worker = new Worker('/hash.js');
                //worker hash完成后返回数据，进行上传
                worker.onmessage = (e)=>{
                    if(e.data.err||!e.data.hash){
                        console.log(e.data.err||'Worker data error');
                        setFileError();
                        return;
                    }
                    setFileStatus(Status.fileStatus.UPLOADING);
                    const hash = e.data.hash;
                    const hashEncoded = encodeURIComponent(hash);
                    //send hash and test if there is such a file on server
                    fetch(url+'?hash='+hashEncoded+'&sliceNum='+Math.ceil(file.size/SliceSize)).then((res)=>{
                        res.json().then((data)=>{
                            if(data.needUpload){
                                _this.divideAndUploadSlice(file,hash,index,data.needUploadIndex).then((data)=>{
                                    if(data){
                                        if(data=='pause'){
                                            resolve('pause');
                                        }
                                        else{
                                            setFileSucc();
                                        }
                                    }
                                },(err)=>{
                                    if(err){
                                        setFileError();
                                    }
                                }).catch((err)=>{
                                    if(err){
                                       setFileError();
                                    }
                                });
                            }else{
                                setFileSucc();
                            }
                        }).catch((err)=>{
                            console.log(err);
                            setFileError();
                        })
                    }).catch((err)=>{
                        console.log(err);
                        setFileError();
                    });
                };
                //向worker发送数据
                worker.postMessage({
                    file:event.target.result
                });
            }
            setFileStatus(Status.fileStatus.HASHING);
            //create filereader
            let reader = new FileReader();
            reader.onload = onload;
            reader.readAsArrayBuffer(file);
        })
        
    }

    //负责将大文件切片和上传，返回promise
    divideAndUploadSlice(file,hash,index,needUploadIndex){
        const _this = this;
        return new Promise((resolve,reject)=>{
            let hasError = false;  //有出错的标志
            if(file.size<SliceSize){    //文件小于分块大小，直接上传
                let formdata = new FormData();
                if(hash){
                    formdata.append('hash',hash);
                }
                formdata.append('name',file.name);
                formdata.append('file',file);
                const _this = this;
                this.postData(formdata,'/upload','multipart/form-data').then((res)=>{
                    if(res.status!=200){
                        reject(res.status);
                    }
                    else{
                        resolve('ok');
                    }
                    
                }).catch((err)=>{
                    if(err){
                        reject(err);
                    }
                });
            }
            else{
                let fileSlices = [];
                let cur = 0;
                let uploadedSliceNum = 0;
                const _this = this;
                //分块
                while(cur<file.size){
                    const curSlice = file.slice(cur,cur+SliceSize);
                    cur += SliceSize;
                    fileSlices.push(curSlice);
                }
                for(let i = 0;i < fileSlices.length;++i){
                    if(_this.state.status==Status.PAUSING){
                        resolve('pause');
                        break;
                    }
                    if(needUploadIndex&&needUploadIndex.indexOf(i)==-1){
                        continue;
                    }
                    const formdata = new FormData();
                    formdata.append('hash',hash);
                    formdata.append('index',i);
                    formdata.append('name',file.name);
                    formdata.append('file',fileSlices[i]);
                    this.postData(formdata,'/upload','multipart/form-data').then((res)=>{
                        if(res.status!=200){
                            hasError = true;
                        }
                        uploadedSliceNum++; //所有切片都收到了回复
                        if(uploadedSliceNum==fileSlices.length||(needUploadIndex&&uploadedSliceNum==needUploadIndex.length)){
                            if(hasError){
                                reject('upload error');
                            }
                            else{   //没有出错的切片，请求合并切片
                                _this.uploadFinish({hash,name:file.name},()=>{reject('err')},()=>{resolve('ok')});
                            }
                        }

                        //计算上传百分比
                        let tmpFileStatus = [..._this.state.fileStatus];
                        if(!needUploadIndex){
                            tmpFileStatus[index].percentage = (uploadedSliceNum/fileSlices.length*100).toFixed(2);
                        }
                        else{
                            tmpFileStatus[index].percentage = (uploadedSliceNum/needUploadIndex.length*100).toFixed(2)
                        }
                        _this.setState({..._this.state,fileStatus:[...tmpFileStatus]});

                    }).catch((err)=>{
                        if(err){
                            hasError = true;
                        }
                    });
                }
            }
        }
        )
    }    
        
    //切片上传完成，负责发送合并切片的请求和接收回复
    uploadFinish(info,errorControl,success){
        const formdata = new FormData();
        formdata.append('finish',true);
        const _this = this;
        Object.keys(info).forEach((key)=>{
            formdata.append(key,info[key]);
        });
        this.postData(formdata,'/upload','multipart/form-data').then((res)=>{
            if(res.status!=200){
                errorControl();
                return;
            }
            success();
        }).catch((err)=>{
            if(err){
                errorControl();
            }
        });
    }

    //fetch发送数据的封装
    postData(data,url,contentType){
        if(contentType=='multipart/form-data'){
            return fetch(url,{
                method:'POST',
                body:data,
            });
        }
        return fetch(url,{
                method:'POST',
                body:data,
                headers:{
                    contentType,
                }
            });
    }    

    //暂停或继续
    pauseOrContinue(){
        if(this.state.status==Status.UPLOADING){
            this.setState({...this.state,status:Status.PAUSING});
            return;
        }
        if(this.state.status==Status.PAUSING){
            this.uploadAll();
        }
    }

    //取消上传，并清除所有文件
    cancel(){
        this.setState({...this.state,status:Status.PAUSING});
        const _this = this;
        setTimeout(()=>{
            _this.setState({files:[],status:Status.INIT,fileStatus:[],fileToUpload:0});
        },0);
    }

    render(){
        const compStatus = this.state.status;
        const uploadBtnEnable = !(compStatus==Status.PAUSING||compStatus==Status.UPLOADING);
        const pauseBtnEnable = (compStatus==Status.UPLOADING||compStatus==Status.PAUSING);

        const buttonStyle = {display:(this.state.files.length>0)?'inline-block':'none'};
        
        return (
            <div id='container'>
                <a>
                    <input title="choose file" type="file" onChange={this.addFile} multiple maxLength="9"></input>
                    choose file
                </a>
                <br></br>
                <button id='upload-btn' style={buttonStyle} onClick={(uploadBtnEnable)?this.uploadAll:undefined}>{(compStatus==Status.ERROR)?'retry':'upload'}</button>
                <button id='pause-btn' style={buttonStyle} onClick={(pauseBtnEnable)?this.pauseOrContinue:undefined}>{(compStatus==Status.PAUSING)?'continue':'pause'}</button>
                <button id='cancel-btn' style={buttonStyle} onClick={this.cancel}>cancel</button>
                <br></br>
                <ul>
                    {this.state.files.map((file,index)=>{
                        const status = this.state.fileStatus[index].status;
                        const barEnable = (status==Status.fileStatus.ERROR||status==Status.fileStatus.UPLOADING);
                        return (
                        <li className="fileList" key={index}>
                            <p title={file.name}>{file.name}</p>
                            <div className="processing" style={({display:(status==Status.fileStatus.HASHING)?"inline-block":'none'})}></div>
                            <div className="bar" style={({display:(barEnable)?'inline-block':'none'})}>
                                <div className="bar-inner" style={({width:(this.state.fileStatus[index].percentage||0)+'%',
                                                                    backgroundColor:(status==Status.fileStatus.ERROR)?'red':'green'})}>
                                </div>
                            </div>
                            <p id='file-finish-p' style={({display:(status==Status.fileStatus.SUCCESS)?"inline-block":'none'})}>finish</p>
                            <p id='file-error-p' style={({display:(status==Status.fileStatus.ERROR)?"inline-block":'none'})}>ERROR</p>
                        </li>);
                    })}
                </ul>
                <p id="error-p" title="Something is wrong, please retry." style={({display:(this.state.status==Status.ERROR)?"inline-block":'none'})}>Something is wrong, please retry.</p>
                <p id="finish-p" style={({display:(this.state.status==Status.SUCCESS)?"inline-block":'none'})}>Upload finish</p>
            </div>
        )
    }
}

export default FileTrans;