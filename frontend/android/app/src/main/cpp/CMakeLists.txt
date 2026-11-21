cmake_minimum_required(VERSION 3.22.1)
project(jarvis_llama LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(ANDROID_STL c++_shared CACHE STRING "" FORCE)

set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_CPU_KLEIDIAI ON CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)

include(FetchContent)
FetchContent_Declare(
    llama_cpp
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG e6d624b9a4b95c6b52f5ca384d70b75581f9821a
    GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(llama_cpp)

add_library(jarvis_llama SHARED jarvis_llama.cpp)
find_library(android-log log)
target_link_libraries(jarvis_llama PRIVATE llama ${android-log})
target_compile_options(jarvis_llama PRIVATE -O3 -fno-exceptions)
