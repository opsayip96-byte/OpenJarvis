cmake_minimum_required(VERSION 3.22.1)
project(jarvis_needle_bridge LANGUAGES C CXX)

set(CACTUS_ARCHIVE "${CMAKE_CURRENT_LIST_DIR}/prebuilt/${ANDROID_ABI}/libcactus.a")
if(NOT EXISTS "${CACTUS_ARCHIVE}")
    message(FATAL_ERROR "Missing Cactus Android static library: ${CACTUS_ARCHIVE}")
endif()

add_library(cactus_engine STATIC IMPORTED GLOBAL)
set_target_properties(cactus_engine PROPERTIES IMPORTED_LOCATION "${CACTUS_ARCHIVE}")

add_library(needlebridge SHARED needle_jni.cpp)
target_include_directories(needlebridge PRIVATE "${CMAKE_CURRENT_LIST_DIR}/include")
target_compile_features(needlebridge PRIVATE cxx_std_17)
target_compile_options(needlebridge PRIVATE -fexceptions -frtti)

find_library(log-lib log)
target_link_libraries(needlebridge PRIVATE cactus_engine c++_shared ${log-lib})

# Cactus Flutter SDK 1.3.0 runtime for the conversational model.
set(CACTUS_SHARED ${CMAKE_CURRENT_LIST_DIR}/../jniLibs/${ANDROID_ABI}/libcactus.so)
if(NOT EXISTS "${CACTUS_SHARED}")
    message(FATAL_ERROR "Missing Cactus conversational runtime: ${CACTUS_SHARED}")
endif()
add_library(cactus_runtime SHARED IMPORTED GLOBAL)
set_target_properties(cactus_runtime PROPERTIES IMPORTED_LOCATION "${CACTUS_SHARED}")

add_library(jarviscore SHARED jarviscore_jni.cpp)
target_compile_features(jarviscore PRIVATE cxx_std_17)
target_compile_options(jarviscore PRIVATE -fexceptions -frtti)
target_link_libraries(jarviscore PRIVATE cactus_runtime c++_shared ${log-lib})
