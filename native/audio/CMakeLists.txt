# bts-audio — PortAudio (ASIO / WASAPI / WDM-KS / MME) + VST3 host helper for BTS Studio
cmake_minimum_required(VERSION 3.19)
project(bts_audio CXX C)
set(CMAKE_CXX_STANDARD 17)
set(DEPS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/deps" CACHE PATH "portaudio / vst3sdk / asiosdk checkouts")

if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>") # static CRT: no VC++ redistributable needed
  add_compile_options(/utf-8)
endif()

# --- PortAudio (static). On Windows the ASIO SDK sits next to it (deps/asiosdk) and is picked up by PortAudio.
set(PA_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(PA_BUILD_STATIC ON CACHE BOOL "" FORCE)
set(PA_DLL_LINK_WITH_STATIC_RUNTIME ON CACHE BOOL "" FORCE)
if(WIN32)
  set(ASIOSDK_ROOT_DIR "${DEPS_DIR}/asiosdk" CACHE PATH "" FORCE)
  set(PA_USE_ASIO ON CACHE BOOL "" FORCE)
endif()
add_subdirectory(${DEPS_DIR}/portaudio portaudio EXCLUDE_FROM_ALL)

# --- VST3 SDK (hosting only, no VSTGUI, no examples)
set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES ${BTS_BUILD_TEST_PLUGINS} CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)
set(SMTG_USE_STATIC_CRT ON CACHE BOOL "" FORCE)
add_subdirectory(${DEPS_DIR}/vst3sdk vst3sdk EXCLUDE_FROM_ALL)

set(SDK ${DEPS_DIR}/vst3sdk)
set(SRC
  src/main.cpp
  ${SDK}/public.sdk/source/vst/hosting/plugprovider.cpp
  ${SDK}/public.sdk/source/common/memorystream.cpp
)
if(WIN32)
  list(APPEND SRC ${SDK}/public.sdk/source/vst/hosting/module_win32.cpp)
elseif(APPLE)
  list(APPEND SRC ${SDK}/public.sdk/source/vst/hosting/module_mac.mm)
else()
  list(APPEND SRC ${SDK}/public.sdk/source/vst/hosting/module_linux.cpp)
endif()

add_executable(bts-audio ${SRC})
target_link_libraries(bts-audio PRIVATE portaudio_static sdk_hosting)
target_include_directories(bts-audio PRIVATE ${DEPS_DIR}/portaudio/include ${SDK})
if(WIN32)
  target_link_libraries(bts-audio PRIVATE ole32 uuid winmm setupapi user32 shell32)
  target_compile_definitions(bts-audio PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
else()
  target_link_libraries(bts-audio PRIVATE pthread dl)
endif()
