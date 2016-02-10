> [AWS Lambda](http://aws.amazon.com/lambda/) function for detecting faces using [OpenCV](http://opencv.org/).

## Setup
0. [Setup EC2 instance](http://docs.aws.amazon.com/AWSEC2/latest/UserGuide/get-set-up-for-amazon-ec2.html) - you will need to build your native modules against the Amazon Linux libraries - see below for details.
1. Install node.js - AWS Lambda uses a [specific version of node](http://docs.aws.amazon.com/lambda/latest/dg/current-supported-versions.html) so preferably that one - see below for details.
2. Clone into this repository
3. Run 'npm install'
4. Setup S3 bucket and modify config.json accordingly
5. Run Gulp - see below
6. Create, upload and test your lambda function
7. Invoke lambda function by uploading to your desination bucket

### EC2
Configure your EC2 instance
```bash
$ sudo yum update
$ sudo yum install gcc44 gcc-c++ libgcc44 cmake
$ sudo yum install libjpeg-devel libpng-devel libjasper-devel libtiff-devel
```

### Node
Manually download, build and install node
```bash
$ wget http://nodejs.org/dist/v0.10.36/node-v0.10.36.tar.gz
$ tar -zxvf node-v0.10.36.tar.gz
$ cd node-v0.10.36 && ./configure && make
$ sudo make install
```

### Gulp
Default gulp task:
- Clean up
- Download, extract, build and install OpenCV - note that 3.x [is not yet fully supported](https://github.com/peterbraden/node-opencv).
- Build opencv module using the statically compiled version. Be sure to configure PKG_CONFIG_PATH according to your OpenCV installation above.
- Copy the index.js and config.json files to the dist directory
- Run npm install in the dist directory
- Zip and upload the function either directly to lambda function or S3 bucket
