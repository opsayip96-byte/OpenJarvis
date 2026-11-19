cmake_minimum_required(VERSION 3.22.1)
project(jarvis_llama_android LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(
    llama_cpp
    GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
    GIT_TAG 7fce5439fe451cd48340b112ec37d2befe02c776
    GIT_SHALLOW FALSE
)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(llama_cpp)

add_library(jarvis_inference SHARED jarvis_inference.cpp)
target_include_directories(jarvis_inference PRIVATE ${llama_cpp_SOURCE_DIR}/include)
target_link_libraries(jarvis_inference PRIVATE llama android log)
