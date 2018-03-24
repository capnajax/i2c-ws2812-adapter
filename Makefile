
PROJECT_NAME = pi-i2c-ws2812-adapter
PROJECT_VERSION = 0.1

DIST_ARCHIVE = ${PROJECT_NAME}-${PROJECT_VERSION}
DIST_BUILD = dist/build/${DIST_ARCHIVE}

BUILD_MACHINE = tjbot-ibm.capnajax.net
BUILD_USERNAME = pi
BUILD_MACHINE_DIR = ~/Documents/ino/

TAR_UPLOAD = ${PROJECT_NAME}.tar



clean:
	rm -rf build

pi-upload: tar
	ssh ${BUILD_MACHINE} -l ${BUILD_USERNAME} 'mkdir -p ${BUILD_MACHINE_DIR}'
	scp -r build/${TAR_UPLOAD} ${BUILD_USERNAME}@${BUILD_MACHINE}:${BUILD_MACHINE_DIR}
	ssh ${BUILD_MACHINE} -l ${BUILD_USERNAME} 'tar xvf ${BUILD_MACHINE_DIR}/${PROJECT_NAME}.tar'

tar: build/${TAR_UPLOAD}

build/${TAR_UPLOAD}: build 
	mkdir -p build/${PROJECT_NAME}
	cp -R ino build/${PROJECT_NAME}
	cd build; tar cf ${TAR_UPLOAD} ${PROJECT_NAME}

build:
	mkdir -p build

