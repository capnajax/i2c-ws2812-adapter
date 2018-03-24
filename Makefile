
PROJECT_NAME = pi-i2c-ws2812-adapter
PROJECT_VERSION = 0.1

DIST_ARCHIVE = ${PROJECT_NAME}-${PROJECT_VERSION}
DIST_BUILD = dist/build/${DIST_ARCHIVE}

BUILD_MACHINE = tjbot-ibm.capnajax.net
BUILD_USERNAME = pi
BUILD_MACHINE_DIR = ~pi/Documents/ino/

TAR_UPLOAD = ${PROJECT_NAME}.tar

SSH = ssh ${BUILD_MACHINE} -l ${BUILD_USERNAME}

clean:
	rm -rf build

pi-node-install: pi-node
	${SSH} 'cd ${BUILD_MACHINE_DIR}${PROJECT_NAME}/node ; npm install'

pi-node: pi-upload

pi-arduino: pi-upload
	${SSH} ls ${BUILD_MACHINE_DIR}${PROJECT_NAME}/ino/adapter
	${SSH} arduino --verify ${BUILD_MACHINE_DIR}${PROJECT_NAME}/ino/adapter/adapter.ino
	${SSH} arduino --upload ${BUILD_MACHINE_DIR}${PROJECT_NAME}/ino/adapter/adapter.ino

pi-upload: tar
	${SSH} 'mkdir -p ${BUILD_MACHINE_DIR}'
	scp -r build/${TAR_UPLOAD} ${BUILD_USERNAME}@${BUILD_MACHINE}:${BUILD_MACHINE_DIR}
	${SSH} 'cd ${BUILD_MACHINE_DIR} ; tar xvf ${BUILD_MACHINE_DIR}/${PROJECT_NAME}.tar'

tar: build/${TAR_UPLOAD}

build/${TAR_UPLOAD}: build 
	mkdir -p build/${PROJECT_NAME}
	tar cf - --exclude node_modules node | (cd build/${PROJECT_NAME} ; tar xf -)
	cp -R ino build/${PROJECT_NAME} 
	cd build; tar cf ${TAR_UPLOAD} ${PROJECT_NAME}

build:
	mkdir -p build

