#include <string.h>

int check_password(const char *input) {
    if (strlen(input) != 7)
        return 0;
    return strcmp(input, "hunter2") == 0;
}
